
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const supabase = require("../config/supabase");

async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ message: "Admin login required." });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ message: "Invalid or expired session." });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    req.adminUser = data.user;
    next();
  } catch (error) {
    console.error("Admin verification error:", error);
    return res.status(500).json({ message: "Authentication check failed." });
  }
}

// List returns, optionally filtered by status.
router.get("/", requireAdmin, async (req, res) => {
  try {
    let query = supabase
      .from("product_returns")
      .select(`
        *,
        device_registry (
          serial_number,
          barcode,
          warranty_until,
          device_status
        ),
        orders (
          order_number,
          payment_status,
          status
        )
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    const allowedStatuses = [
      "requested",
      "inspecting",
      "approved",
      "rejected",
      "completed",
    ];

    if (req.query.status && allowedStatuses.includes(req.query.status)) {
      query = query.eq("status", req.query.status);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({ returns: data || [] });
  } catch (error) {
    console.error("List returns error:", error.message);
    return res.status(500).json({ message: "Unable to load returns." });
  }
});

// Create a return request for a registered device.
router.post("/", requireAdmin, async (req, res) => {
  try {
    const {
      device_id,
      customer_name,
      customer_email,
      customer_phone,
      reason,
    } = req.body;

    if (
      !device_id ||
      !customer_name?.trim() ||
      !customer_email?.trim() ||
      !customer_phone?.trim() ||
      !reason?.trim()
    ) {
      return res.status(400).json({
        message: "Complete all required return details.",
      });
    }

    if (reason.trim().length > 2000) {
      return res.status(400).json({
        message: "Return reason must be 2,000 characters or fewer.",
      });
    }

    const { data: device, error: deviceError } = await supabase
      .from("device_registry")
      .select(`
        id,
        order_id,
        device_status,
        orders (
          payment_status,
          status
        )
      `)
      .eq("id", device_id)
      .maybeSingle();

    if (deviceError) throw deviceError;

    if (!device) {
      return res.status(404).json({
        message: "Device not found in the registry.",
      });
    }

    if (
      device.orders?.payment_status !== "paid" ||
      device.orders?.status === "cancelled"
    ) {
      return res.status(409).json({
        message: "The device must be linked to a paid, non-cancelled order.",
      });
    }

    if (device.device_status !== "sold") {
      return res.status(409).json({
        message: "This device is not currently marked as sold.",
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("product_returns")
      .select("id, status")
      .eq("device_id", device_id)
      .in("status", ["requested", "inspecting", "approved"])
      .limit(1);

    if (existingError) throw existingError;

    if (existing?.length) {
      return res.status(409).json({
        message: "An active return already exists for this device.",
      });
    }

    const returnNumber =
      "DCR-" +
      new Date().toISOString().slice(0, 10).replaceAll("-", "") +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    const { data: created, error: createError } = await supabase
      .from("product_returns")
      .insert({
        return_number: returnNumber,
        device_id,
        order_id: device.order_id,
        customer_name: customer_name.trim(),
        customer_email: customer_email.trim(),
        customer_phone: customer_phone.trim(),
        reason: reason.trim(),
      })
      .select()
      .single();

    if (createError) {
      if (createError.code === "23505") {
        return res.status(409).json({
          message: "A return with this reference already exists.",
        });
      }
      throw createError;
    }

    return res.status(201).json({
      message: "Return request recorded.",
      return: created,
    });
  } catch (error) {
    console.error("Create return error:", error.message);
    return res.status(500).json({
      message: "Unable to create the return request.",
    });
  }
});

// Update inspection and resolution.
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const allowedStatuses = [
      "requested",
      "inspecting",
      "approved",
      "rejected",
      "completed",
    ];

    const allowedResolutions = [
      "refund",
      "replacement",
      "repair",
      "no_action",
    ];

    const { status, inspection_notes, resolution, refund_amount } = req.body;

    const { data: current, error: currentError } = await supabase
      .from("product_returns")
      .select("id, status, device_id, resolution")
      .eq("id", req.params.id)
      .maybeSingle();

    if (currentError) throw currentError;

    if (!current) {
      return res.status(404).json({ message: "Return record not found." });
    }

    if (
      !status ||
      !allowedStatuses.includes(status) ||
      !allowedStatuses.includes(current.status)
    ) {
      return res.status(400).json({ message: "Invalid return status." });
    }

    if (["rejected", "completed"].includes(current.status)) {
      return res.status(409).json({
        message: "This return has already reached a final status.",
      });
    }

    if (
      resolution !== undefined &&
      resolution !== null &&
      !allowedResolutions.includes(resolution)
    ) {
      return res.status(400).json({ message: "Invalid resolution." });
    }

    if (
      refund_amount !== undefined &&
      (typeof refund_amount !== "number" ||
        !Number.isFinite(refund_amount) ||
        refund_amount < 0)
    ) {
      return res.status(400).json({
        message: "Refund amount must be a non-negative number.",
      });
    }

    if (
      status === "completed" &&
      !["refund", "replacement", "repair", "no_action"].includes(
        resolution || current.resolution
      )
    ) {
      return res.status(400).json({
        message: "Choose a resolution before completing the return.",
      });
    }

    const update = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (inspection_notes !== undefined) {
      if (
        typeof inspection_notes !== "string" ||
        inspection_notes.length > 5000
      ) {
        return res.status(400).json({
          message: "Inspection notes must be 5,000 characters or fewer.",
        });
      }
      update.inspection_notes = inspection_notes.trim();
    }

    if (resolution !== undefined) update.resolution = resolution;
    if (refund_amount !== undefined) update.refund_amount = refund_amount;

    const { data: updated, error: updateError } = await supabase
      .from("product_returns")
      .update(update)
      .eq("id", req.params.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // A completed replacement/return must be reviewed operationally.
    // This route deliberately does not alter inventory or issue refunds.
    return res.json({
      message: "Return record updated.",
      return: updated,
    });
  } catch (error) {
    console.error("Update return error:", error.message);
    return res.status(500).json({
      message: "Unable to update the return record.",
    });
  }
});

module.exports = router;
