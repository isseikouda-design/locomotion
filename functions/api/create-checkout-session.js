import Stripe from 'stripe';

const PRODUCTS = {
  object001: {
    name: 'object001',
    price: 32000,
  },
  object002: {
    name: 'object002',
    price: 32000,
  },
  object003: {
    name: 'object003',
    price: 32000,
  },
  object004: {
    name: 'object004',
    price: 32000,
  },
  object005: {
    name: 'object005',
    price: 32000,
  },
  object006: {
    name: 'object006',
    price: 32000,
  },
  object007: {
    name: 'object007',
    price: 32000,
  },
  object008: {
    name: 'object008',
    price: 32000,
  },
  object009: {
    name: 'object009',
    price: 32000,
  },
};

export async function onRequestPost(context) {
  const stripe = new Stripe(context.env.STRIPE_SECRET_KEY);

  const { items } = await context.request.json();

  const line_items = items.map((item) => {
    const product = PRODUCTS[item.productId];

    if (!product) {
      throw new Error(`Unknown product: ${item.productId}`);
    }

    return {
      price_data: {
        currency: 'jpy',
        product_data: {
          name: product.name,
        },
        unit_amount: product.price,
      },
      quantity: item.quantity,
    };
  });

  const origin = new URL(context.request.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items,
    success_url: `${origin}/index.html?checkout=success`,
    cancel_url: `${origin}/index.html?checkout=cancel`,
  });

  return Response.json({
    url: session.url,
  });
}