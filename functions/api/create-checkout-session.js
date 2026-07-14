const PRODUCTS = {
  object001: { name: 'object001', price: 32000 },
  object002: { name: 'object002', price: 22000 },
  object003: { name: 'object003', price: 18000 },
  object004: { name: 'object004', price: 16000 },
  object005: { name: 'object005', price: 42000 },
  object006: { name: 'object006', price: 32000 },
  object007: { name: 'object007', price: 34000 },
  object008: { name: 'object008', price: 22000 },
  object009: { name: 'object009', price: 22000 },
};

export async function onRequestPost(context) {
  const reservedProductIds = [];

  try {
    if (!context.env.DB) {
      return Response.json(
        { error: 'Missing D1 database binding' },
        { status: 500 }
      );
    }

    if (!context.env.STRIPE_SECRET_KEY) {
      return Response.json(
        { error: 'Missing Stripe secret key' },
        { status: 500 }
      );
    }

    const { items } = await context.request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json(
        { error: 'Cart is empty' },
        { status: 400 }
      );
    }

    /*
     * 商品情報をサーバー側のPRODUCTSから作成
     * 数量は一点物のため必ず1
     */
    const orderItems = items.map((item) => {
      const product = PRODUCTS[item.productId];

      if (!product) {
        throw new Error(`Unknown product: ${item.productId}`);
      }

      return {
        productId: item.productId,
        name: product.name,
        price: product.price,
        quantity: 1,
      };
    });

    /*
     * 同一商品が複数回送られてきた場合は拒否
     */
    const productIds = orderItems.map((item) => item.productId);

    if (new Set(productIds).size !== productIds.length) {
      return Response.json(
        { error: 'Duplicate product in cart' },
        { status: 400 }
      );
    }

    /*
     * availableの商品だけを原子的にreservedへ変更
     *
     * 同時に2人が購入しようとしても、
     * 最初の1人だけchanges = 1になる
     */
    for (const item of orderItems) {
      const result = await context.env.DB.prepare(`
        UPDATE product_inventory
        SET
          status = 'reserved',
          checkout_session_id = NULL,
          sold_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
          AND status = 'available'
      `)
        .bind(item.productId)
        .run();

      if (!result.meta?.changes) {
        /*
         * 途中まで予約できていた商品をavailableへ戻す
         */
        for (const reservedProductId of reservedProductIds) {
          await context.env.DB.prepare(`
            UPDATE product_inventory
            SET
              status = 'available',
              checkout_session_id = NULL,
              sold_at = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ?
              AND status = 'reserved'
              AND checkout_session_id IS NULL
          `)
            .bind(reservedProductId)
            .run();
        }

        return Response.json(
          {
            error: `${item.productId} is sold out or reserved`,
            productId: item.productId,
          },
          { status: 409 }
        );
      }

      reservedProductIds.push(item.productId);
    }

    const origin = new URL(context.request.url).origin;
    const body = new URLSearchParams();

    body.append('mode', 'payment');
    body.append(
      'metadata[items_json]',
      JSON.stringify(orderItems)
    );
    body.append(
  'expires_at',
  String(Math.floor(Date.now() / 1000) + 30 * 60)
);

    body.append(
      'success_url',
      `${origin}/index.html?checkout=success`
    );

    body.append(
      'cancel_url',
      `${origin}/index.html?checkout=cancel`
    );

    body.append('billing_address_collection', 'required');
    body.append(
      'shipping_address_collection[allowed_countries][0]',
      'JP'
    );

    orderItems.forEach((item, index) => {
      body.append(
        `line_items[${index}][price_data][currency]`,
        'jpy'
      );

      body.append(
        `line_items[${index}][price_data][product_data][name]`,
        item.name
      );

      body.append(
        `line_items[${index}][price_data][unit_amount]`,
        String(item.price)
      );

      body.append(
        `line_items[${index}][quantity]`,
        '1'
      );
    });

    const stripeRes = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }
    );

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      /*
       * Stripe Session作成失敗時は予約を解除
       */
      for (const productId of reservedProductIds) {
        await context.env.DB.prepare(`
          UPDATE product_inventory
          SET
            status = 'available',
            checkout_session_id = NULL,
            sold_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ?
            AND status = 'reserved'
            AND checkout_session_id IS NULL
        `)
          .bind(productId)
          .run();
      }

      return Response.json(
        {
          error: 'Stripe session creation failed',
          detail:
            session.error?.message ||
            session.error ||
            session,
        },
        { status: stripeRes.status }
      );
    }

    /*
     * 作成されたCheckout Session IDを予約商品へ保存
     */
    for (const productId of reservedProductIds) {
      await context.env.DB.prepare(`
        UPDATE product_inventory
        SET
          checkout_session_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ?
          AND status = 'reserved'
          AND checkout_session_id IS NULL
      `)
        .bind(session.id, productId)
        .run();
    }

    return Response.json({
      url: session.url,
    });
  } catch (err) {
    /*
     * 予期しないエラー時にも、
     * Session ID未設定の予約を解除
     */
    if (context.env.DB) {
      for (const productId of reservedProductIds) {
        try {
          await context.env.DB.prepare(`
            UPDATE product_inventory
            SET
              status = 'available',
              checkout_session_id = NULL,
              sold_at = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE product_id = ?
              AND status = 'reserved'
              AND checkout_session_id IS NULL
          `)
            .bind(productId)
            .run();
        } catch (releaseError) {
          console.error(
            'Failed to release reservation:',
            productId,
            releaseError
          );
        }
      }
    }

    console.error('Checkout error:', err);

    return Response.json(
      {
        error: err.message || 'Checkout failed',
      },
      { status: 500 }
    );
  }
}