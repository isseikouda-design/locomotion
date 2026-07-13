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
  try {
    const { items } = await context.request.json();

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: 'Cart is empty' }, { status: 400 });
    }
    if (!context.env.DB) {
  return Response.json(
    { error: 'Missing D1 database binding' },
    { status: 500 }
  );
}

    const origin = new URL(context.request.url).origin;
const body = new URLSearchParams();

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

body.append('mode', 'payment');
body.append('metadata[items_json]', JSON.stringify(orderItems));
body.append('success_url', `${origin}/index.html?checkout=success`);
body.append('cancel_url', `${origin}/index.html?checkout=cancel`);
body.append('billing_address_collection', 'required');
body.append('shipping_address_collection[allowed_countries][0]', 'JP');

for (const item of items) {
  const inventory = await context.env.DB.prepare(
    `
    SELECT status
    FROM product_inventory
    WHERE product_id = ?
    `
  )
    .bind(item.productId)
    .first();

  if (!inventory) {
    throw new Error(`Inventory not found: ${item.productId}`);
  }

  if (inventory.status !== 'available') {
  return Response.json(
    {
      error: `${item.productId} is sold out`,
      productId: item.productId,
    },
    { status: 409 }
  );
}
}

    items.forEach((item, index) => {
      const product = PRODUCTS[item.productId];

      if (!product) {
        throw new Error(`Unknown product: ${item.productId}`);
      }

      body.append(`line_items[${index}][price_data][currency]`, 'jpy');
      body.append(`line_items[${index}][price_data][product_data][name]`, product.name);
      body.append(`line_items[${index}][price_data][unit_amount]`, String(product.price));
      body.append(
  `line_items[${index}][quantity]`,
  '1'
);
    });

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const data = await res.json();

    if (!res.ok) {
      return Response.json(data, { status: res.status });
    }

    return Response.json({ url: data.url });
  } catch (err) {
    return Response.json(
      { error: err.message || 'Checkout failed' },
      { status: 500 }
    );
  }
}