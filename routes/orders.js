
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const supabase = require("../config/supabase");

function createOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `DC-${date}-${random}`;
}

router.post("/", async (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      delivery_address,
      items,
    } = req.body;

    if (
      typeof customer_name !== "string" ||
      typeof customer_email !== "string" ||
      typeof customer_phone !== "string" ||
      typeof delivery_address !== "string" ||
      !customer_name.trim() ||
      !customer_email.trim() ||
      !customer_phone.trim() ||
      !delivery_address.trim()
    ) {
      return res.status(400).json({
        message: "Please provide your name, email, phone and delivery address.",
      });
    }

    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 30
    ) {
      return res.status(400).json({
        message: "Your order must contain between 1 and 30 different products.",
      });
    }

    const quantities = new Map();

    for (const item of items) {
      const productId = item?.product_id;
      const quantity = Number(item?.quantity);

      if (
        typeof productId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 100
      ) {
        return res.status(400).json({
          message: "One or more product IDs or quantities are invalid.",
        });
      }

      quantities.set(
        productId,
        (quantities.get(productId) || 0) + quantity
      );
    }

    const productIds = [...quantities.keys()];

    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id, name, price, stock")
      .in("id", productIds);

    if (productError) throw productError;

    if (!products || products.length !== productIds.length) {
      return res.status(400).json({
        message: "One or more products are no longer available.",
      });
    }

    const productById = new Map(
      products.map((product) => [product.id, product])
    );

    const orderItems = [];
    let total = 0;

    for (const [productId, quantity] of quantities.entries()) {
      const product = productById.get(productId);

      if (!product || Number(product.stock) < quantity) {
        return res.status(409).json({
          message: `Insufficient stock for ${product?.name || "a selected product"}. Please update your cart.`,
        });
      }

      const price = Number(product.price);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error("A product has an invalid price.");
      }

      const subtotal = Math.round(price * 100) * quantity / 100;
      total += subtotal;

      orderItems.push({
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: price,
        subtotal,
      });
    }

    total = Math.round(total * 100) / 100;

    // This creates a pending order only. It does not collect payment
    // or reserve/decrement stock. Those operations need a database
    // transaction before this is ready for production.
    let order;
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_number: createOrderNumber(),
          customer_name: customer_name.trim().slice(0, 120),
          customer_email: customer_email.trim().slice(0, 254),
          customer_phone: customer_phone.trim().slice(0, 40),
          delivery_address: delivery_address.trim().slice(0, 500),
          total_amount: total,
          status: "pending",
          payment_status: "unpaid",
        })
        .select()
        .single();

      if (!error) {
        order = data;
        break;
      }

      lastError = error;

      if (error.code !== "23505") {
        throw error;
      }
    }

    if (!order) throw lastError || new Error("Could not create order.");

    const rows = orderItems.map((item) => ({
      ...item,
      order_id: order.id,
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(rows);

    if (itemsError) {
      // Prevent leaving a header behind if the item insertion fails.
      await supabase.from("orders").delete().eq("id", order.id);
      throw itemsError;
    }

    return res.status(201).json({
      message: "Order request received. Payment has not been taken.",
      order: {
        id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        delivery_address: order.delivery_address,
        total_amount: Number(order.total_amount),
        status: order.status,
        payment_status: order.payment_status,
        created_at: order.created_at,
      },
      items: orderItems,
    });
  } catch (error) {
    console.error("Create order error:", error.message);

    return res.status(500).json({
      message: "We could not create your order. Please try again.",
    });
  }
});

module.exports = router;
