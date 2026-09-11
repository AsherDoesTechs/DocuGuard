const express = require("express");
const router = express.Router();
const documentController = require("../controllers/documentController");
const authMiddleware = require("../middleware/auth");

router.use(authMiddleware);

router.get("/", documentController.getAllDocuments);
router.get("/:id", documentController.getDocumentById);
router.post("/", documentController.createDocument);
router.put("/:id", documentController.updateDocument);
router.delete("/:id", documentController.deleteDocument);

router.get("/upload-url", documentController.getUploadUrl);
router.post("/process", documentController.processDocument);
router.post("/verify", documentController.verifyDocument);
router.post("/sync", documentController.syncDocument);

module.exports = router;
