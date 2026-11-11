
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

// Require a valid Supabase user who is listed as an admin.
async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);

    if (userError || !userData?.user) {
      return res.status(401).json({
        message: "Your session is invalid or expired.",
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({
        message: "Administrator access required.",
      });
    }

    req.adminUser = userData.user;
    next();
  } catch (error) {
    console.error("Admin authentication error:", error);
    return res.status(500).json({
      message: "Unable to verify administrator access.",
    });
  }
}

// Verify a device using its serial number or barcode.
// GET /api/admin/devices/verify?serial=...
// GET /api/admin/devices/verify?barcode=...
router.get("/verify", requireAdmin, async (req, res) => {
  try {
    const serial = String(req.query.serial || "").trim();
    const barcode = String(req.query.barcode || "").trim();

    if ((!serial && !barcode) || (serial && barcode)) {
      return res.status(400).json({
        message: "Provide either a serial number or a barcode.",
      });
    }

    let query = supabase
      .from("device_registry")
      .select(`
        id,
        serial_number,
        barcode,
        warranty_until,
        device_status,
        registered_at,
        orders (
          id,
          order_number,
          status,
          payment_status,
          created_at
        ),
        order_items (
          product_name,
          quantity,
          unit_price
        ),
        products (
          name,
          brand,
          category
        )
      `);

    query = serial
      ? query.ilike("serial_number", serial)
      : query.ilike("barcode", barcode);

    const { data: device, error } = await query.maybeSingle();

    if (error) {
      console.error("Device lookup error:", error.message);
      return res.status(500).json({
        message: "Unable to check this device right now.",
      });
    }

    if (!device) {
      return res.status(404).json({
        verified: false,
        message:
          "No matching device was found in the DAVID COMMUNICATIONS registry.",
      });
    }

    const order = device.orders;
    const isVerified =
      order?.payment_status === "paid" &&
      order?.status !== "cancelled";

    return res.json({
      verified: isVerified,
      message: isVerified
        ? "The device matches a recorded paid order."
        : "A device record exists, but its order is not confirmed as paid.",
      device,
    });
  } catch (error) {
    console.error("Device verification error:", error);
    return res.status(500).json({
      message: "An unexpected error occurred.",
    });
  }
});

// Register one physical device against an order item.
// POST /api/admin/devices
router.post("/", requireAdmin, async (req, res) => {
  try {
    const {
      order_item_id,
      serial_number,
      barcode,
      warranty_until,
    } = req.body;

    const serial = String(serial_number || "").trim();
    const code = String(barcode || "").trim();

    if (!order_item_id || (!serial && !code)) {
      return res.status(400).json({
        message: "An order item and serial number or barcode are required.",
      });
    }

    if (
      warranty_until &&
      !/^\d{4}-\d{2}-\d{2}$/.test(warranty_until)
    ) {
      return res.status(400).json({
        message: "Warranty date must use YYYY-MM-DD format.",
      });
    }

    const { data: item, error: itemError } = await supabase
      .from("order_items")
      .select(`
        id,
        order_id,
        product_id,
        product_name,
        quantity,
        orders (
          id,
          status,
          payment_status
        )
      `)
      .eq("id", order_item_id)
      .maybeSingle();

    if (itemError) {
      console.error("Order item lookup error:", itemError.message);
      return res.status(500).json({
        message: "Unable to check the order item.",
      });
    }

    if (!item) {
      return res.status(404).json({
        message: "Order item not found.",
      });
    }

    if (
      item.orders?.payment_status !== "paid" ||
      item.orders?.status === "cancelled"
    ) {
      return res.status(409).json({
        message: "Only items from a paid, non-cancelled order can be registered.",
      });
    }

    // Do not register more physical devices than the quantity ordered.
    const { count, error: countError } = await supabase
      .from("device_registry")
      .select("id", { count: "exact", head: true })
      .eq("order_item_id", order_item_id);

    if (countError) {
      console.error("Device count error:", countError.message);
      return res.status(500).json({
        message: "Unable to check registered device quantity.",
      });
    }

    if (count >= item.quantity) {
      return res.status(409).json({
        message: "All devices for this order item have already been registered.",
      });
    }

    const { data: device, error: insertError } = await supabase
      .from("device_registry")
      .insert({
        order_id: item.order_id,
        order_item_id: item.id,
        product_id: item.product_id,
        serial_number: serial || null,
        barcode: code || null,
        warranty_until: warranty_until || null,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return res.status(409).json({
          message: "That serial number or barcode is already registered.",
        });
      }

      console.error("Device registration error:", insertError.message);
      return res.status(500).json({
        message: "Unable to register this device.",
      });
    }

    return res.status(201).json({
      message: "Device registered successfully.",
      device,
    });
  } catch (error) {
    console.error("Device registration error:", error);
    return res.status(500).json({
      message: "An unexpected error occurred.",
    });
  }
});

module.exports = router;
