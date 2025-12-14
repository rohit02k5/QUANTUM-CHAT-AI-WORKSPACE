const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const User = require("../models/userModel");
const dotenv = require("dotenv");

dotenv.config();

// Serialize user to session
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser((id, done) => {
    User.findById(id).then((user) => {
        done(null, user);
    });
});

// Google Strategy
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID || "dummy_id",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "dummy_secret",
            callbackURL: "/api/v1/auth/google/callback",
            proxy: true,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Check if user already exists
                const existingUser = await User.findOne({ googleId: profile.id });
                if (existingUser) {
                    return done(null, existingUser);
                }

                // If user exists with same email but no googleId, merge them?
                // Simple approach: Check email
                const userWithEmail = await User.findOne({ email: profile.emails[0].value });
                if (userWithEmail) {
                    userWithEmail.googleId = profile.id;
                    await userWithEmail.save();
                    return done(null, userWithEmail);
                }

                // Create new user
                const newUser = await User.create({
                    username: profile.displayName,
                    email: profile.emails[0].value,
                    googleId: profile.id,
                    // No password for OAuth users
                });

                done(null, newUser);
            } catch (err) {
                done(err, null);
            }
        }
    )
);

// GitHub Strategy
passport.use(
    new GitHubStrategy(
        {
            clientID: process.env.GITHUB_CLIENT_ID || "dummy_id",
            clientSecret: process.env.GITHUB_CLIENT_SECRET || "dummy_secret",
            callbackURL: "/api/v1/auth/github/callback",
            scope: ['user:email'],
            proxy: true,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const existingUser = await User.findOne({ githubId: profile.id });
                if (existingUser) {
                    return done(null, existingUser);
                }

                // GitHub might not expose email publicly; handle gracefully or require permission
                const email = profile.emails && profile.emails[0] ? profile.emails[0].value : `${profile.username}@github.com`;

                const userWithEmail = await User.findOne({ email: email });
                if (userWithEmail) {
                    userWithEmail.githubId = profile.id;
                    await userWithEmail.save();
                    return done(null, userWithEmail);
                }

                const newUser = await User.create({
                    username: profile.username,
                    email: email,
                    githubId: profile.id,
                });

                done(null, newUser);
            } catch (err) {
                done(err, null);
            }
        }
    )
);

module.exports = passport;
