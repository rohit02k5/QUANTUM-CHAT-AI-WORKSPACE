const errorHandler = require("../middlewares/errorMiddleware");
const userModel = require("../models/userModel");
const errorResponse = require("../utils/errorResponse");
exports.sendToken = (user, statusCode, res) => {
    const token = user.getSignedToken(res);
    console.log("Generated Token for user " + user.username + ":", token); // Debug Log
    res.status(statusCode).json({
        success: true,
        token,
    });
};

exports.registerController = async (req, res, next) => {
    try {
        const { username, email, password } = req.body
        const existingEmail = await userModel.findOne({ email })
        if (existingEmail) {
            return next(new errorResponse("Email is already registered", 500))
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
            return next(new errorResponse("Please provide email or password"))
        }
        const user = await userModel.findOne({ email })
        if (!user) {
            return next(new errorResponse("Invalid email or password", 401))
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

// Forgot Password
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");

exports.forgotPasswordController = async (req, res, next) => {
    const { email } = req.body;

    try {
        const user = await userModel.findOne({ email });

        if (!user) {
            return next(new errorResponse("Email could not be sent", 404));
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

            res.status(200).json({ success: true, data: "Email Sent" });
        } catch (err) {
            console.error("EMAIL_SEND_ERROR:", err); // Log full error
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save();
            return next(new errorResponse(`Email failed: ${err.message}`, 500));
        }
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
