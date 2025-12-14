const express = require("express");
const { registerController, loginController, logoutController } = require('../controllers/authController');
const passport = require("passport");
const router = express.Router();

router.post('/register', registerController)
router.post('/login', loginController)
router.post('/logout', logoutController)

// --- Google OAuth ---
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
    "/google/callback",
    passport.authenticate("google", { session: false, failureRedirect: "/login" }),
    (req, res) => {
        // Generate Token
        const token = req.user.getSignedToken(res);
        console.log("Google OAuth Token Generated:", token); // Debug Log
        // Redirect to Frontend with Token
        const clientURL = process.env.CLIENT_URL || "http://localhost:3000";
        res.redirect(`${clientURL}/login?token=${token}`);
    }
);

// --- GitHub OAuth ---
router.get("/github", passport.authenticate("github", { scope: ["user:email"] }));

router.get(
    "/github/callback",
    passport.authenticate("github", { session: false, failureRedirect: "/login" }),
    (req, res) => {
        const token = req.user.getSignedToken(res);
        const clientURL = process.env.CLIENT_URL || "http://localhost:3000";
        res.redirect(`${clientURL}/login?token=${token}`);
    }
);

// --- Password Reset ---
router.post("/forgot-password", require("../controllers/authController").forgotPasswordController);
router.post("/reset-password/:resetToken", require("../controllers/authController").resetPasswordController);

module.exports = router