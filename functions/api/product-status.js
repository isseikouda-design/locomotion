export async function onRequestGet(context) {
  try {
    if (!context.env.DB) {
      return Response.json(
        { error: 'Missing D1 database binding' },
        { status: 500 }
      );
    }

    const url = new URL(context.request.url);
    const productId = url.searchParams.get('productId');

    if (!productId) {
      return Response.json(
        { error: 'Missing productId' },
        { status: 400 }
      );
    }

    const inventory = await context.env.DB.prepare(`
      SELECT product_id, status
      FROM product_inventory
      WHERE product_id = ?
    `)
      .bind(productId)
      .first();

    if (!inventory) {
      return Response.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    return Response.json({
      productId: inventory.product_id,
      status: inventory.status,
    });
  } catch (err) {
    console.error('Product status error:', err);

    return Response.json(
      { error: err.message || 'Failed to get product status' },
      { status: 500 }
    );
  }
}