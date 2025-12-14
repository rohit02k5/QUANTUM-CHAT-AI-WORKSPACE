const colors =require("colors");
const { default: mongoose } = require("mongoose");
const connectDB = async ()=>{
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`Connected to MongoDb Database ${mongoose.connection.host}`.bgMagenta.white);
    } catch (error) {
        console.log(`Mongodb Database Error ${error}`.bgRed.white);
    }
};
module.exports=connectDB;