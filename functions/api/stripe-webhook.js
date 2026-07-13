async function verifyStripeSignature(request, secret) {
  const signature = request.headers.get('stripe-signature');

  if (!signature || !secret) {
    throw new Error('Missing Stripe signature or webhook secret');
  }

  const body = await request.text();

  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );

  const timestamp = parts.t;
  const expectedSignature = parts.v1;

  if (!timestamp || !expectedSignature) {
    throw new Error('Invalid Stripe signature header');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signedPayload = `${timestamp}.${body}`;

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );

  const computedSignature = [...new Uint8Array(signatureBuffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSignature !== expectedSignature) {
    throw new Error('Invalid Stripe signature');
  }

  return JSON.parse(body);
}

export async function onRequestPost(context) {
  try {
    const event = await verifyStripeSignature(
      context.request,
      context.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type !== 'checkout.session.completed') {
      return Response.json({ received: true });
    }

   const session = event.data.object;

if (session.payment_status !== 'paid') {
  console.log(
    'Checkout completed but payment is not paid:',
    session.id,
    session.payment_status
  );

  return Response.json({ received: true });
}

    const shipping = session.shipping_details || {};
const customer = session.customer_details || {};

const shippingAddress = shipping.address || null;
const customerAddress = customer.address || null;

const address = shippingAddress || customerAddress || {};
const shippingName = shipping.name || customer.name || '';

if (!context.env.DB) {
  throw new Error('Missing D1 database binding');
}
const itemsJson = session.metadata?.items_json || '[]';

let orderItems;

try {
  orderItems = JSON.parse(itemsJson);
} catch {
  throw new Error('Invalid items_json metadata');
}

if (!Array.isArray(orderItems) || orderItems.length === 0) {
  throw new Error('Missing order items');
}

    await context.env.DB.prepare(`
      INSERT OR IGNORE INTO orders (
        session_id,
        payment_intent,
        email,
        customer_name,
        amount_total,
        currency,
        payment_status,
        fulfillment_status,
        items_json,
        shipping_name,
        shipping_address_line1,
        shipping_address_line2,
        shipping_city,
        shipping_state,
        shipping_postal_code,
        shipping_country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.id,
      session.payment_intent || '',
      session.customer_details?.email || '',
      session.customer_details?.name || '',
      session.amount_total || 0,
      session.currency || '',
      session.payment_status || '',
      'unfulfilled',
      itemsJson,
      shippingName,
address.line1 || '',
address.line2 || '',
address.city || '',
address.state || '',
address.postal_code || '',
address.country || ''
    ).run();

    for (const item of orderItems) {
  if (!item.productId) {
    throw new Error('Missing productId in order item');
  }

  const inventory = await context.env.DB.prepare(`
    SELECT product_id
    FROM product_inventory
    WHERE product_id = ?
  `)
    .bind(item.productId)
    .first();

  if (!inventory) {
    throw new Error(`Inventory not found: ${item.productId}`);
  }

  await context.env.DB.prepare(`
    UPDATE product_inventory
    SET
      status = 'sold',
      checkout_session_id = ?,
      sold_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE product_id = ?
  `)
    .bind(
      session.id,
      session.created || Math.floor(Date.now() / 1000),
      item.productId
    )
    .run();
}

    return Response.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);

    return Response.json(
      { error: err.message || 'Webhook failed' },
      { status: 400 }
    );
  }
}