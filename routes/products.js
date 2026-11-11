
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const supabase = require("../config/supabase");

const router = express.Router();

const allowedCategories = [
  "Phones",
  "Laptops",
  "Game Consoles",
  "Accessories",
  "Audio",
];

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

// Verify that the request has a valid Supabase session
// and belongs to an approved administrator.
async function requireAdmin(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        error: "Authorization token is required.",
      });
    }

    const authClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: userData, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !userData.user) {
      return res.status(401).json({
        error: "Your session is invalid or expired. Please sign in again.",
      });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError) {
      console.error("Admin lookup failed:", adminError.message);

      return res.status(500).json({
        error: "Could not verify administrator permissions.",
      });
    }

    if (!admin) {
      return res.status(403).json({
        error: "This account is not an approved administrator.",
      });
    }

    req.admin = userData.user;
    next();
  } catch (error) {
    console.error("Admin verification error:", error.message);

    return res.status(500).json({
      error: "Unable to verify admin access.",
    });
  }
}

// GET /api/products
// Public product catalogue.
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, brand, category, description, price, stock, image_urls, created_at, updated_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Product listing failed:", error.message);

      return res.status(500).json({
        error: "Unable to load products.",
      });
    }

    return res.json(data || []);
  } catch (error) {
    console.error("Product listing error:", error.message);

    return res.status(500).json({
      error: "Unable to load products.",
    });
  }
});

// GET /api/products/admin/check
// Used by the React admin login page after authentication.
router.get("/admin/check", requireAdmin, (req, res) => {
  res.json({
    success: true,
    message: "Administrator access verified.",
    user: {
      id: req.admin.id,
      email: req.admin.email,
    },
  });
});

// Validate and normalize product fields.
function validateProduct(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const brand = typeof body.brand === "string" ? body.brand.trim() : "";
  const category =
    typeof body.category === "string" ? body.category.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const price = Number(body.price);
  const stock = Number(body.stock);

  const imageUrls = Array.isArray(body.image_urls)
    ? body.image_urls
    : [];

  if (!name) {
    return { error: "Product name is required." };
  }

  if (!allowedCategories.includes(category)) {
    return { error: "Please select a valid product category." };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be a valid non-negative number." };
  }

  if (!Number.isInteger(stock) || stock < 0) {
    return { error: "Stock must be a non-negative whole number." };
  }

  if (imageUrls.length > 8) {
    return { error: "A maximum of 8 product images is allowed." };
  }

  const validImages = imageUrls.every((url) => {
    if (typeof url !== "string") return false;

    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:";
    } catch {
      return false;
    }
  });

  if (!validImages) {
    return { error: "Product images must use valid HTTPS URLs." };
  }

  return {
    value: {
      name,
      brand,
      category,
      description,
      price,
      stock,
      image_urls: imageUrls,
    },
  };
}

// POST /api/products
router.post("/", requireAdmin, async (req, res) => {
  const validation = validateProduct(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const { data, error } = await supabase
      .from("products")
      .insert(validation.value)
      .select()
      .single();

    if (error) {
      console.error("Product creation failed:", error.message);

      return res.status(500).json({
        error: "Could not create product.",
      });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error("Product creation error:", error.message);

    return res.status(500).json({
      error: "Could not create product.",
    });
  }
});

// PUT /api/products/:id
router.put("/:id", requireAdmin, async (req, res) => {
  const validation = validateProduct(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const { data, error } = await supabase
      .from("products")
      .update(validation.value)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("Product update failed:", error.message);

      return res.status(500).json({
        error: "Could not update product.",
      });
    }

    if (!data) {
      return res.status(404).json({
        error: "Product not found.",
      });
    }

    return res.json(data);
  } catch (error) {
    console.error("Product update error:", error.message);

    return res.status(500).json({
      error: "Could not update product.",
    });
  }
});

// DELETE /api/products/:id
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Product deletion failed:", error.message);

      return res.status(500).json({
        error: "Could not delete product.",
      });
    }

    if (!data) {
      return res.status(404).json({
        error: "Product not found.",
      });
    }

    return res.json({
      success: true,
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.error("Product deletion error:", error.message);

    return res.status(500).json({
      error: "Could not delete product.",
    });
  }
});

module.exports = router;
