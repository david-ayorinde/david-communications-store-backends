
const express = require("express");
const { supabase } = require("../config/supabase");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

const allowedStatuses = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "completed",
  "cancelled",
];

const allowedPaymentStatuses = ["unpaid", "paid", "refunded"];

router.use(requireAdmin);

// GET /api/admin/orders
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error("Load orders error:", error.message);
    res.status(500).json({ message: "Could not load orders." });
  }
});

// GET /api/admin/orders/:id
router.get("/:id", async (req, res) => {
  try {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (orderError) throw orderError;

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", order.id);

    if (itemsError) throw itemsError;

    res.json({ order, items: items || [] });
  } catch (error) {
    console.error("Order detail error:", error.message);
    res.status(500).json({ message: "Could not load order details." });
  }
});

// PATCH /api/admin/orders/:id/status
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid order status." });
    }

    const { data: existing, error: findError } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (existing.status === "cancelled" && status !== "cancelled") {
      return res.status(400).json({
        message: "Cancelled orders cannot be reopened in this version.",
      });
    }

    if (existing.status === "completed" && status !== "completed") {
      return res.status(400).json({
        message: "Completed orders cannot be changed in this version.",
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Order status updated.",
      order: data,
    });
  } catch (error) {
    console.error("Update order status error:", error.message);
    res.status(500).json({ message: "Could not update order status." });
  }
});

// PATCH /api/admin/orders/:id/payment-status
router.patch("/:id/payment-status", async (req, res) => {
  try {
    const { payment_status } = req.body;

    if (!allowedPaymentStatuses.includes(payment_status)) {
      return res.status(400).json({ message: "Invalid payment status." });
    }

    const { data: existing, error: findError } = await supabase
      .from("orders")
      .select("id, status, payment_status")
      .eq("id", req.params.id)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (existing.status === "cancelled" && payment_status === "paid") {
      return res.status(400).json({
        message: "Cannot mark a cancelled order as paid.",
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ payment_status })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: "Payment status updated.",
      order: data,
    });
  } catch (error) {
    console.error("Update payment status error:", error.message);
    res.status(500).json({ message: "Could not update payment status." });
  }
});

module.exports = router;
