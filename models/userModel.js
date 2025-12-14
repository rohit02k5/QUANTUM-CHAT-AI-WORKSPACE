const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Define the User schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String }, // Optional for OAuth
  googleId: { type: String },
  githubId: { type: String },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  createdAt: { type: Date, default: Date.now },
});

// Hash the password before saving the user
userSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next(); // Skip hashing if password isn't modified

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);

    next(); // Proceed to the next middleware
  } catch (err) {
    next(err); // Pass errors to the next middleware
  }
});

// Method to compare provided password with the hashed password
userSchema.methods.matchPassword = async function (password) {
  try {
    return await bcrypt.compare(password, this.password);
  } catch (err) {
    console.error("Error comparing passwords:", err);
    throw new Error("Error comparing passwords.");
  }
};

// Method to generate JWT tokens and set a refresh token in cookies
userSchema.methods.getSignedToken = function (res) {
  try {
    // Generate access token
    const accessToken = jwt.sign(
      { id: this._id },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.JWT_ACCESS_EXPIREIN }
    );
    console.log("JWT Sign Result:", accessToken); // Debug Log

    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: this._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIREIN }
    );

    // Set refresh token in cookies with secure options
    res.cookie("refreshToken", refreshToken, {
      maxAge: 86400 * 7000, // Example expiration (adjust as needed)
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Ensure secure cookies in production
      sameSite: "strict",
    });

    return accessToken; // Return the access token
  } catch (err) {
    console.error("Error generating tokens:", err);
    throw new Error("Token generation failed.");
  }
};

// Create and export the User model
const User = mongoose.model("User", userSchema);
module.exports = User;