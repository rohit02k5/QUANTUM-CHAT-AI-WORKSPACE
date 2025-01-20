const express=require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const colors =require("colors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const connectDB =require("./config/db");
const authRoutes=require('./routes/authRoute');
const openaiRoutes = require("./routes/openaiRoutes");
const errorHandler = require("./middlewares/errorMiddleware");

const helmet = require('helmet');
 dotenv.config();
 const app=express();
connectDB();
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  })
);
app.use(cors());
 app.use(express.json());
 app.use(bodyParser.urlencoded({extended:true}));
app.use(morgan("dev"));
app.use(errorHandler);
const PORT =process.env.PORT || 8080;
app.use("/api/v1/auth",authRoutes);
app.use("/api/v1/openai",require("./routes/openaiRoutes"));
app.use(errorHandler);
app.listen(PORT,()=>{
    console.log(`Server Running in ${process.env.DEV_MODE} on ${PORT}`.bgCyan.white);
});
