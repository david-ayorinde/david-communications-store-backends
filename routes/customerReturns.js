
const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

router.post("/", async (req, res) => {
  try {
    const {
      order_number,
      identifier,
      customer_name,
      customer_email,
      customer_phone,
      reason,
    } = req.body || {};

    const fields = [
      order_number,
      identifier,
      customer_name,
      customer_email,
      customer_phone,
      reason,
    ];

    if (
      fields.some(
        (value) => typeof value !== "string" || !value.trim()
      )
    ) {
      return res.status(400).json({
        message: "Please complete every field.",
      });
    }

    if (
      order_number.length > 100 ||
      identifier.length > 200 ||
      customer_name.length > 150 ||
      customer_email.length > 254 ||
      customer_phone.length > 40 ||
      reason.length > 2000
    ) {
      return res.status(400).json({
        message: "One or more fields exceed the allowed length.",
      });
    }

    const email = customer_email.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address.",
      });
    }

    const { data, error } = await supabase.rpc(
      "create_return_request",
      {
        p_order_number: order_number.trim(),
        p_identifier: identifier.trim(),
        p_customer_name: customer_name.trim(),
        p_customer_email: email,
        p_customer_phone: customer_phone.trim(),
        p_reason: reason.trim(),
      }
    );

    if (error) {
      const message = error.message || "";

      if (
        /could not match|must be paid|not currently eligible|active return request already exists/i.test(
          message
        )
      ) {
        return res.status(400).json({
          message:
            "We could not approve this request for submission. Check your order details or contact DAVID COMMUNICATIONS.",
        });
      }

      console.error("Return request error:", message);

      return res.status(500).json({
        message: "Unable to submit your request right now.",
      });
    }

    return res.status(201).json({
      message: "Your return request has been received.",
      return: data,
    });
  } catch (error) {
    console.error("Customer return error:", error);

    return res.status(500).json({
      message: "An unexpected error occurred.",
    });
  }
});

module.exports = router;
