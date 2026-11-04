const express = require("express");
const { requireSignIn } = require("../middlewares/authMiddleware");
const { listPersonas, createPersona, updatePersona, deletePersona } = require("../controllers/personaController");

const router = express.Router();
router.use(requireSignIn);

router.get("/", listPersonas);
router.post("/", createPersona);
router.patch("/:id", updatePersona);
router.delete("/:id", deletePersona);

module.exports = router;
