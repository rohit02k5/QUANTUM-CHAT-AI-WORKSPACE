const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || "Server Error";
  
    // Custom error cases
    if (err.name === "CastError") {
      message = "Resource not found";
      statusCode = 404;
    } else if (err.code === 11000) {
      message = "Duplicate field value entered";
      statusCode = 400;
    } else if (err.name === "ValidationError") {
      message = Object.values(err.errors).map((val) => val.message).join(", ");
      statusCode = 400;
    }
  
    res.status(statusCode).json({
      success: false,
      error: message,
    });
  };
  
  module.exports = errorHandler;
  