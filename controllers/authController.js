const errorHandler = require("../middlewares/errorMiddleware");
const userModel = require("../models/userModel");
const errorResponse = require("../utils/errorResponse");
exports.sendToken = (user, statusCode, res) => {
    const { accessToken, refreshToken } = user.getSignedToken(res);
    res.status(statusCode).json({
        success: true,
        token: accessToken,
        refreshToken,
    });
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.registerController = async (req, res, next) => {
    try {
        const { username, email, password } = req.body
        if (!username || !email || !password) {
            return next(new errorResponse("Please provide username, email and password", 400))
        }
        if (!EMAIL_RE.test(email)) {
            return next(new errorResponse("Please provide a valid email", 400))
        }
        if (password.length < 6) {
            return next(new errorResponse("Password must be at least 6 characters", 400))
        }
        const existingEmail = await userModel.findOne({ email })
        if (existingEmail) {
            return next(new errorResponse("Email is already registered", 409))
        }
        const user = await userModel.create({ username, email, password })
        this.sendToken(user, 201, res);
    } catch (error) {
        console.log(error)
        next(error)
    }
};

exports.loginController = async (req, res, next) => {
    // Your logic for logging in
    try {
        const { email, password } = req.body
        if (!email || !password) {
            return next(new errorResponse("Please provide email and password", 400))
        }
        const user = await userModel.findOne({ email })
        if (!user) {
            return next(new errorResponse("Invalid email or password", 401))
        }
        if (!user.password) {
            return next(new errorResponse("This account uses social login. Sign in with Google or GitHub.", 400))
        }
        const isMatch = await user.matchPassword(password)
        if (!isMatch) {
            return next(new errorResponse("Invalid email or password", 401))
        }
        this.sendToken(user, 200, res);
    } catch (error) {
        console.log(error)
        next(error)
    }
};

exports.logoutController = async (req, res) => {
    // Your logic for logging out
    res.clearCookie("refreshToken");
    return res.status(200).json({
        success: true,
        message: 'Logout succesfully'
    })
};

// Refresh access token — accepts refresh token from body (SPA) or httpOnly cookie
exports.refreshController = async (req, res) => {
    try {
        const refreshToken = req.body.refreshToken || req.cookies?.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({ success: false, error: "No refresh token" });
        }
        const decoded = require("jsonwebtoken").verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const user = await userModel.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ success: false, error: "User not found" });
        }
        exports.sendToken(user, 200, res);
    } catch (err) {
        return res.status(401).json({ success: false, error: "Invalid or expired refresh token" });
    }
};

// Forgot Password
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");

exports.forgotPasswordController = async (req, res, next) => {
    const { email } = req.body;

    try {
        const user = await userModel.findOne({ email });

        // Always respond the same way so attackers can't enumerate registered emails
        if (!user) {
            return res.status(200).json({ success: true, data: "If that email exists, a reset link was sent" });
        }

        // Generate Token
        const resetToken = crypto.randomBytes(20).toString("hex");

        // Hash and set to resetPasswordToken field
        user.resetPasswordToken = crypto
            .createHash("sha256")
            .update(resetToken)
            .digest("hex");

        // Set expire time (10 minutes)
        user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

        await user.save();

        // Create reset url to frontend
        const clientURL = process.env.CLIENT_URL || "http://localhost:3000";
        const resetUrl = `${clientURL}/reset-password/${resetToken}`;

        const message = `
      <h1>You have requested a password reset</h1>
      <p>Please go to this link to reset your password:</p>
      <a href=${resetUrl} clicktracking=off>${resetUrl}</a>
    `;

        try {
            await sendEmail({
                email: user.email,
                subject: "Password Reset Request",
                message,
            });

            res.status(200).json({ success: true, data: "If that email exists, a reset link was sent" });
        } catch (err) {
            console.error("EMAIL_SEND_ERROR:", err);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save();
            return next(new errorResponse("Email could not be sent, please try again later", 500));
        }
    } catch (err) {
        next(err);
    }
};

// Delete the authenticated user's account and EVERY artifact they own —
// the cascade registry (utils/accountCascade) is the single source of truth
// and a test asserts it covers every model with a `user` path.
//
// Confirmation is required and differs by account type:
//   - password accounts: {password} must verify against matchPassword
//   - OAuth-only accounts: {confirmEmail} must equal the account email AND
//     {confirmToken} must match a fresh token from POST /account/delete-token
// Irreversible. Rate-limited via authLimiter on the /api/v1/auth mount.
exports.deleteAccountController = async (req, res, next) => {
    try {
        const crypto = require("crypto");
        const mongoose = require("mongoose");
        const { cascadeDelete } = require("../utils/accountCascade");
        const user = await userModel.findById(req.user._id).select("+password");
        if (!user) return next(new errorResponse("User not found", 404));

        if (user.password) {
            const { password } = req.body || {};
            if (!password || !(await user.matchPassword(password))) {
                return next(new errorResponse("Password confirmation failed", 401));
            }
        } else {
            // OAuth-only: typed email + a fresh short-lived confirm token.
            const { confirmEmail, confirmToken } = req.body || {};
            if (!confirmEmail || String(confirmEmail).toLowerCase() !== String(user.email).toLowerCase()) {
                return next(new errorResponse("Type your account email to confirm deletion", 400));
            }
            const hash = confirmToken && crypto.createHash("sha256").update(String(confirmToken)).digest("hex");
            const doc = hash && await mongoose.connection.collection("deletionconfirms").findOne({
                _id: user._id, tokenHash: hash, expireAt: { $gt: new Date() },
            });
            if (!doc) {
                return next(new errorResponse("Fresh confirmation required — request a new confirm token", 403));
            }
        }

        const uid = req.user._id;
        const deleted = await cascadeDelete(uid);
        await mongoose.connection.collection("deletionconfirms").deleteMany({ _id: uid });
        await userModel.deleteOne({ _id: uid });
        res.clearCookie("refreshToken");
        res.status(200).json({ success: true, message: "Account and all associated data deleted", deleted });
    } catch (err) {
        next(err);
    }
};

// Minimal account info — drives UI like the delete-account confirmation
// (password vs OAuth-only flow) without leaking anything sensitive.
exports.meController = async (req, res, next) => {
    try {
        const user = await userModel.findById(req.user._id).select("email password googleId githubId username memoryEnabled memoryNoticeSeen");
        if (!user) return next(new errorResponse("User not found", 404));
        res.status(200).json({
            success: true,
            user: {
                username: user.username,
                email: user.email,
                hasPassword: !!user.password,
                oauth: !!(user.googleId || user.githubId),
                memoryEnabled: user.memoryEnabled !== false,
                memoryNoticeSeen: !!user.memoryNoticeSeen,
            },
        });
    } catch (err) {
        next(err);
    }
};

// Issue a short-lived (60s) deletion confirmation token for OAuth-only
// accounts. Authenticated POST — proves a fresh, intentional re-auth.
exports.issueDeletionToken = async (req, res, next) => {
    try {
        const crypto = require("crypto");
        const mongoose = require("mongoose");
        const token = crypto.randomBytes(24).toString("hex");
        const coll = mongoose.connection.collection("deletionconfirms");
        await coll.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
        await coll.updateOne(
            { _id: req.user._id },
            {
                $set: {
                    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
                    expireAt: new Date(Date.now() + 60 * 1000),
                },
            },
            { upsert: true }
        );
        res.status(200).json({ success: true, confirmToken: token, expiresInSec: 60 });
    } catch (err) {
        next(err);
    }
};

// Reset Password
exports.resetPasswordController = async (req, res, next) => {
    const resetPasswordToken = crypto
        .createHash("sha256")
        .update(req.params.resetToken)
        .digest("hex");

    try {
        const user = await userModel.findOne({
            resetPasswordToken,
            resetPasswordExpire: { $gt: Date.now() },
        });

        if (!user) {
            return next(new errorResponse("Invalid Reset Token", 400));
        }

        user.password = req.body.password; // Will be hashed by pre-save hook
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;

        await user.save();

        exports.sendToken(user, 201, res);
    } catch (err) {
        next(err);
    }
};
