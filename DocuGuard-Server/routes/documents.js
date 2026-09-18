const express = require("express");
const router = express.Router();
const documentController = require("../controllers/documentController");
const authMiddleware = require("../middleware/auth");
const { asyncHandler } = require("../utils/asyncHandler");

router.use(authMiddleware);

router.get("/", asyncHandler(documentController.getAllDocuments));
router.get("/:id", asyncHandler(documentController.getDocumentById));
router.post("/", asyncHandler(documentController.createDocument));
router.put("/:id", asyncHandler(documentController.updateDocument));
router.delete("/:id", asyncHandler(documentController.deleteDocument));

router.get("/upload-url", asyncHandler(documentController.getUploadUrl));
router.post("/process", asyncHandler(documentController.processDocument));
router.post("/verify", asyncHandler(documentController.verifyDocument));
router.post("/sync", asyncHandler(documentController.syncDocument));

module.exports = router;