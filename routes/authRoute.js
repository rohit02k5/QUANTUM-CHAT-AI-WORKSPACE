const express = require("express");
const { registerController, loginController, logoutController } = require('../controllers/authController');
const passport = require("passport");
const router = express.Router();

router.post('/register', registerController)
router.post('/login', loginController)
router.post('/logout', logoutController)

// --- Token Refresh ---
router.post("/refresh", require("../controllers/authController").refreshController);

// --- Current-account info (drives the delete-account UI flow) ---
router.get(
    "/me",
    require("../middlewares/authMiddleware").requireSignIn,
    require("../controllers/authController").meController
);

// --- Account deletion (authenticated, deletes the user + all their data).
// Password users confirm with {password}; OAuth-only users confirm with
// {confirmEmail} + a fresh {confirmToken} from the delete-token endpoint. ---
router.post(
    "/account/delete-token",
    require("../middlewares/authMiddleware").requireSignIn,
    require("../controllers/authController").issueDeletionToken
);
router.delete(
    "/account",
    require("../middlewares/authMiddleware").requireSignIn,
    require("../controllers/authController").deleteAccountController
);

// --- Google OAuth ---
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
    "/google/callback",
    passport.authenticate("google", { session: false, failureRedirect: "/login" }),
    (req, res) => {
        // Generate Token
        const { accessToken, refreshToken } = req.user.getSignedToken(res);
        // Redirect to Frontend with Token
        const clientURL = process.env.CLIENT_URL || "http://localhost:3000";
        res.redirect(`${clientURL}/login?token=${accessToken}&rt=${refreshToken}`);
    }
);

// --- GitHub OAuth ---
router.get("/github", passport.authenticate("github", { scope: ["user:email"] }));

router.get(
    "/github/callback",
    passport.authenticate("github", { session: false, failureRedirect: "/login" }),
    (req, res) => {
        const { accessToken, refreshToken } = req.user.getSignedToken(res);
        const clientURL = process.env.CLIENT_URL || "http://localhost:3000";
        res.redirect(`${clientURL}/login?token=${accessToken}&rt=${refreshToken}`);
    }
);

// --- Password Reset ---
router.post("/forgot-password", require("../controllers/authController").forgotPasswordController);
router.post("/reset-password/:resetToken", require("../controllers/authController").resetPasswordController);

module.exports = router