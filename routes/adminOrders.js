
const express = require("express");
const supabase = require("../config/supabase");

const router = express.Router();

const allowedStatuses = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "completed",
  "cancelled",
];

async function requireAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({ message: "Please sign in." });
    }

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({ message: "Invalid session." });
    }

    const { data: admin, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (error) throw error;

    if (!admin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    next();
  } catch (error) {
    console.error("Admin authorization error:", error.message);
    res.status(500).json({ message: "Could not verify admin access." });
  }
}

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

module.exports = router;
