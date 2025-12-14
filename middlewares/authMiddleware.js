const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

exports.requireSignIn = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        try {
            token = req.headers.authorization.split(" ")[1];

            // CRITICAL FIX: Handle "Bearer undefined" case
            if (!token || token === "undefined" || token === "null") {
                return res.status(401).json({ message: "Not authorized, invalid token format" });
            }

            console.log("Middleware Received Token:", token); // Debugging line
            const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
            req.user = await User.findById(decoded.id).select("-password");
            if (!req.user) {
                return res.status(401).json({ message: "Not authorized, user not found" });
            }
            console.log("Auth Success for:", req.user?.username);
            next();
        } catch (error) {
            console.error("Auth Token Verification Failed:", error.message);
            res.status(401).json({ message: "Not authorized, token failed: " + error.message });
        }
    }

    if (!token) {
        res.status(401).json({ message: "Not authorized, no token" });
    }
};
