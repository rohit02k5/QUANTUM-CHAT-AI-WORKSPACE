const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // Use STARTTLS
        auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD,
        },
        logger: true,
        debug: true,
        connectionTimeout: 60000, // Increased to 60 seconds
        greetingTimeout: 30000,   // 30 seconds
        socketTimeout: 60000,     // 60 seconds
        family: 4,                // Keep IPv4 force
    });

    const message = {
        from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_EMAIL}>`,
        to: options.email,
        subject: options.subject,
        html: options.message,
    };

    await transporter.sendMail(message);
};

module.exports = sendEmail;
