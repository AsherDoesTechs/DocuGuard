import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  PanResponder,
  Animated,
  ActivityIndicator,
  FlatList,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Camera } from "expo-camera";
import { COLORS } from "@/constants";
import { useAlert } from "./AlertService";

let ScannerPlugin: any = null;

try {
  ScannerPlugin = require("react-native-document-scanner-plugin");
} catch (e) {
  console.log("Scanner native module not found");
}

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTS                                 */
/* -------------------------------------------------------------------------- */

const MAX_PAGES = 10;

const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

const MAX_PAGE_DISPLAY_WIDTH = 1200;
const MAX_PAGE_DISPLAY_HEIGHT = 1600;

const REVIEW_THUMBNAIL_SIZE = 90;

const { width: SCREEN_WIDTH } = Dimensions.get("window");

/* -------------------------------------------------------------------------- */
/*                                    TYPES                                   */
/* -------------------------------------------------------------------------- */

export interface ScannedImageItem {
  uri: string;
  width: number;
  height: number;
}

interface DocumentScannerProps {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (data: {
    images: ScannedImageItem[];
  }) => void;
}

type ScannerPhase =
  | "preparing"
  | "capturing"
  | "processing"
  | "review"
  | "success"
  | "error";

type QualityStatus =
  | "good"
  | "low-resolution"
  | "portrait"
  | "landscape"
  | "unknown";

/* -------------------------------------------------------------------------- */
/*                              HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

function isValidImageUri(uri: unknown): uri is string {
  if (typeof uri !== "string") {
    return false;
  }

  const value = uri.trim();

  return (
    value.startsWith("file://") ||
    value.startsWith("content://") ||
    value.startsWith("data:image/")
  );
}

function filterValidImageUris(scannedImages: unknown): string[] {
  if (!Array.isArray(scannedImages)) {
    return [];
  }

  return scannedImages.filter(isValidImageUri);
}

function getQualityStatus(
  width: number,
  height: number
): QualityStatus {
  if (!width || !height) {
    return "unknown";
  }

  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    return "low-resolution";
  }

  if (height > width) {
    return "portrait";
  }

  if (width > height) {
    return "landscape";
  }

  return "good";
}

/**
 * Prevents the same URI from being inserted multiple times.
 */
function mergeUniqueImages(
  existing: ScannedImageItem[],
  incoming: ScannedImageItem[]
): ScannedImageItem[] {
  const result = [...existing];

  for (const image of incoming) {
    const alreadyExists = result.some(
      (existingImage) => existingImage.uri === image.uri
    );

    if (!alreadyExists && result.length < MAX_PAGES) {
      result.push(image);
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/*                           MAIN SCANNER COMPONENT                           */
/* -------------------------------------------------------------------------- */

export const DocumentScannerComponent = ({
  visible,
  onClose,
  onScanSuccess,
}: DocumentScannerProps) => {
  const [visibleState, setVisibleState] = useState(false);

  const [phase, setPhase] =
    useState<ScannerPhase>("preparing");

  const [scanning, setScanning] = useState(false);

  const [scannedImages, setScannedImages] = useState<
    ScannedImageItem[]
  >([]);

  // Mirrors scannedImages so callbacks can read the current list without
  // taking scannedImages as a dependency.
  const scannedImagesRef = useRef<ScannedImageItem[]>([]);

  const [selectedPage, setSelectedPage] = useState(0);

  const [scanAttempt, setScanAttempt] = useState(0);

  const slideAnim = useRef(
    new Animated.Value(100)
  ).current;

  const timeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const closedRef = useRef(false);

  const mountedRef = useRef(true);

  const submittingRef = useRef(false);

  // captureDocument and processScannedImages call each other (retry buttons and
  // the processing step). A ref breaks the cycle without stale closures.
  const captureDocumentRef = useRef<() => Promise<void>>(
    async () => {}
  );

  const { alert } = useAlert();

  /* ------------------------------------------------------------------------ */
  /*                              TIMER CLEANUP                               */
  /* ------------------------------------------------------------------------ */

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  /* ------------------------------------------------------------------------ */
  /*                              MOUNT CLEANUP                               */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      closedRef.current = true;

      clearTimers();
    };
  }, [clearTimers]);

  /* ------------------------------------------------------------------------ */
  /*                                  OPEN                                    */
  /* ------------------------------------------------------------------------ */

  const open = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    closedRef.current = false;
    submittingRef.current = false;

    setVisibleState(true);
    setScanning(false);
    setPhase("preparing");

    scannedImagesRef.current = [];
    setScannedImages([]);
    setSelectedPage(0);
    setScanAttempt(0);

    slideAnim.setValue(100);

    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  /* ------------------------------------------------------------------------ */
  /*                         PROCESS SCANNED IMAGES                           */
  /* ------------------------------------------------------------------------ */

  const processScannedImages = useCallback(
    async (imageUris: string[]) => {
      if (
        closedRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      setPhase("processing");

      const processedImages: ScannedImageItem[] = [];

      for (const imageUri of imageUris) {
        if (
          closedRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        await new Promise<void>((resolve) => {
          Image.getSize(
            imageUri,
            (width, height) => {
              if (
                width >= MIN_WIDTH &&
                height >= MIN_HEIGHT
              ) {
                processedImages.push({
                  uri: imageUri,
                  width,
                  height,
                });
              }

              resolve();
            },
            () => {
              resolve();
            }
          );
        });
      }

      if (
        closedRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      if (processedImages.length === 0) {
        setScanning(false);
        setPhase("error");

        alert(
          "Scan Quality Too Low",
          `The captured document does not meet the minimum resolution requirement of ${MIN_WIDTH} × ${MIN_HEIGHT} pixels. Please hold the device steady and try again.`,
          {
            type: "error",
            buttons: [
              {
                text: "Cancel",
                onPress: onClose,
              },
              {
                text: "Try Again",
                onPress: () => {
                  captureDocumentRef.current();
                },
              },
            ],
          }
        );

        return;
      }

      // Merge eagerly against a ref mirror so the new selection can be derived from
      // the real merged length. mergeUniqueImages drops duplicates and enforces
      // MAX_PAGES, so the count cannot be inferred from processedImages.length.
      const merged = mergeUniqueImages(
        scannedImagesRef.current,
        processedImages
      );

      scannedImagesRef.current = merged;

      setScannedImages(merged);
      setSelectedPage(Math.max(0, Math.min(selectedPage, merged.length - 1)));

      setScanning(false);
      setPhase("review");
    },
    [alert, onClose]
  );

  /* ------------------------------------------------------------------------ */
  /*                              CAPTURE                                     */
  /* ------------------------------------------------------------------------ */

  const captureDocument = useCallback(async () => {
    if (
      scanning ||
      closedRef.current ||
      !mountedRef.current
    ) {
      return;
    }

    const currentCount = scannedImagesRef.current.length;

    if (currentCount >= MAX_PAGES) {
      alert(
        "Maximum Pages Reached",
        `You can scan a maximum of ${MAX_PAGES} pages in one document.`,
        {
          type: "warning",
        }
      );

      return;
    }

    setPhase("preparing");
    setScanning(true);

    setScanAttempt((previous) => previous + 1);

    try {
      /* -------------------------------------------------------------------- */
      /*                        CAMERA PERMISSION                              */
      /* -------------------------------------------------------------------- */

      const { status } =
        await Camera.requestCameraPermissionsAsync();

      if (status !== "granted") {
        if (!mountedRef.current) {
          return;
        }

        setScanning(false);
        setPhase("error");

        alert(
          "Camera Permission Required",
          "Camera access is required to scan documents. Please enable camera access in your device settings.",
          {
            type: "warning",
            buttons: [
              {
                text: "OK",
                onPress: onClose,
              },
            ],
          }
        );

        return;
      }

      if (
        closedRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      /* -------------------------------------------------------------------- */
      /*                              CAPTURE                                  */
      /* -------------------------------------------------------------------- */

      setPhase("capturing");

      const scanner = ScannerPlugin?.default;

      if (!scanner?.scanDocument) {
        setScanning(false);
        setPhase("error");

        alert(
          "Scanner Unavailable",
          "The native document scanner is not available in this build. Please use a development client or a production build that includes the document scanner module.",
          {
            type: "error",
            buttons: [
              {
                text: "Close",
                onPress: onClose,
              },
            ],
          }
        );

        return;
      }

      const result = await scanner.scanDocument();

      if (
        closedRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      const remainingSlots = MAX_PAGES - scannedImagesRef.current.length;

      const validImages =
        filterValidImageUris(
          result?.scannedImages
        ).slice(0, remainingSlots);

      if (validImages.length === 0) {
        setScanning(false);
        setPhase("error");

        alert(
          "Scan Cancelled",
          "The document scan was cancelled or no valid image was captured.",
          {
            type: "warning",
            buttons: [
              {
                text: "Cancel",
                style: "cancel",
                onPress: onClose,
              },
              {
                text: "Try Again",
                onPress: () => {
                  captureDocumentRef.current();
                },
              },
            ],
          }
        );

        return;
      }

      /* -------------------------------------------------------------------- */
      /*                            PROCESS                                    */
      /* -------------------------------------------------------------------- */

      await processScannedImages(validImages);
    } catch (error: any) {
      if (
        closedRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      console.error(
        "Document scanner error:",
        error
      );

      setScanning(false);
      setPhase("error");

      alert(
        "Scanning Error",
        "Something went wrong while capturing the document. Please try again.",
        {
          type: "error",
          buttons: [
            {
              text: "Cancel",
              onPress: onClose,
            },
            {
              text: "Try Again",
              onPress: () => {
                captureDocumentRef.current();
              },
            },
          ],
        }
      );
    }
  }, [
    alert,
    onClose,
    processScannedImages,
    scannedImages.length,
    scanning,
  ]);

  // Keep the ref pointing at the latest captureDocument so the retry buttons in
  // processScannedImages always invoke the current implementation.
  useEffect(() => {
    captureDocumentRef.current = captureDocument;
  }, [captureDocument]);

  /* ------------------------------------------------------------------------ */
  /*                         VISIBILITY HANDLING                              */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (visible) {
      open();

      clearTimers();

      timeoutRef.current = setTimeout(() => {
        if (
          !closedRef.current &&
          mountedRef.current
        ) {
          captureDocumentRef.current();
        }
      }, 500);

      return () => {
        closedRef.current = true;
        clearTimers();
      };
    }

    closedRef.current = true;
    clearTimers();

    if (mountedRef.current) {
      setVisibleState(false);
      setScanning(false);
      setPhase("preparing");

      slideAnim.stopAnimation();
      slideAnim.setValue(100);
    }
    // captureDocument is intentionally read through the ref: including it here
    // would re-run this effect after every scan, resetting pages and reopening
    // the camera.
  }, [
    visible,
    open,
    clearTimers,
    slideAnim,
  ]);

  /* ------------------------------------------------------------------------ */
  /*                                  CLOSE                                   */
  /* ------------------------------------------------------------------------ */

  const handleClose = useCallback(() => {
    if (scanning) {
      return;
    }

    closedRef.current = true;

    clearTimers();

    if (!mountedRef.current) {
      onClose();
      return;
    }

    setScanning(false);

    Animated.timing(slideAnim, {
      toValue: 100,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      if (!mountedRef.current) {
        return;
      }

      setVisibleState(false);
      setPhase("preparing");
      scannedImagesRef.current = [];
      setScannedImages([]);
      setSelectedPage(0);

      onClose();
    });
  }, [
    clearTimers,
    onClose,
    scanning,
    slideAnim,
  ]);

  /* ------------------------------------------------------------------------ */
  /*                         RETAKE CURRENT PAGE                              */
  /* ------------------------------------------------------------------------ */

  const handleRetakeCurrentPage = useCallback(() => {
    if (
      scanning ||
      scannedImages.length === 0 ||
      selectedPage < 0 ||
      selectedPage >= scannedImages.length
    ) {
      return;
    }

    const remaining = scannedImagesRef.current.filter(
      (_, index) => index !== selectedPage
    );

    scannedImagesRef.current = remaining;
    setScannedImages(remaining);

    setSelectedPage((previous) =>
      Math.max(0, previous - 1)
    );

    timeoutRef.current = setTimeout(() => {
      captureDocumentRef.current();
    }, 150);
  }, [
    scanning,
    scannedImages.length,
    selectedPage,
  ]);

  /* ------------------------------------------------------------------------ */
  /*                           DELETE PAGE                                    */
  /* ------------------------------------------------------------------------ */

  const handleDeletePage = useCallback(
    (index: number) => {
      if (scanning) {
        return;
      }

      if (
        index < 0 ||
        index >= scannedImages.length
      ) {
        return;
      }

      if (scannedImages.length === 1) {
        alert(
          "Remove Document?",
          "This will remove the only scanned page.",
          {
            type: "warning",
            buttons: [
              {
                text: "Cancel",
                style: "cancel",
              },
              {
                text: "Remove",
                style: "destructive",
                onPress: () => {
                  scannedImagesRef.current = [];
                  setScannedImages([]);
                  setSelectedPage(0);
                  setScanAttempt(0);
                  setPhase("preparing");
                },
              },
            ],
          }
        );

        return;
      }

      const remaining = scannedImagesRef.current.filter(
        (_, pageIndex) => pageIndex !== index
      );

      scannedImagesRef.current = remaining;
      setScannedImages(remaining);

      setSelectedPage((previous) => {
        if (index < previous) {
          return previous - 1;
        }

        if (
          index === previous &&
          previous >= scannedImages.length - 1
        ) {
          return Math.max(0, previous - 1);
        }

        return previous;
      });
    },
    [
      alert,
      scanning,
      scannedImages.length,
    ]
  );

  /* ------------------------------------------------------------------------ */
  /*                           MOVE PAGE                                      */
  /* ------------------------------------------------------------------------ */

  const movePage = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (scanning) {
        return;
      }

      if (
        fromIndex < 0 ||
        fromIndex >= scannedImages.length ||
        toIndex < 0 ||
        toIndex >= scannedImages.length
      ) {
        return;
      }

      const updated = [...scannedImagesRef.current];

      const [moved] = updated.splice(fromIndex, 1);

      updated.splice(toIndex, 0, moved);

      scannedImagesRef.current = updated;
      setScannedImages(updated);

      setSelectedPage(toIndex);
    },
    [scanning]
  );

  /* ------------------------------------------------------------------------ */
  /*                         ACCEPT SCAN                                      */
  /* ------------------------------------------------------------------------ */

  const handleUseScan = useCallback(() => {
    if (
      submittingRef.current ||
      scanning ||
      scannedImages.length === 0 ||
      closedRef.current ||
      !mountedRef.current
    ) {
      return;
    }

    submittingRef.current = true;

    setPhase("success");

    clearTimers();

    timeoutRef.current = setTimeout(() => {
      if (
        closedRef.current ||
        !mountedRef.current
      ) {
        submittingRef.current = false;
        return;
      }

      onScanSuccess({
        images: scannedImages,
      });

      submittingRef.current = false;
    }, 700);
  }, [
    clearTimers,
    onScanSuccess,
    scannedImages,
    scanning,
  ]);

  /* ------------------------------------------------------------------------ */
  /*                         SWIPE TO CLOSE                                   */
  /* ------------------------------------------------------------------------ */

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (
        _,
        gestureState
      ) => {
        if (scanning) {
          return false;
        }

        return (
          Math.abs(gestureState.dy) >
            Math.abs(gestureState.dx) &&
          gestureState.dy > 10
        );
      },

      onPanResponderMove: (
        _,
        gestureState
      ) => {
        if (scanning) {
          return;
        }

        const nextY = Math.max(
          0,
          gestureState.dy
        );

        slideAnim.setValue(nextY);
      },

      onPanResponderRelease: (
        _,
        gestureState
      ) => {
        if (scanning) {
          return;
        }

        if (gestureState.dy > 100) {
          handleClose();
          return;
        }

        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },

      onPanResponderTerminate: () => {
        if (scanning) {
          return;
        }

        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  /* ------------------------------------------------------------------------ */
  /*                         REVIEW PAGE                                      */
  /* ------------------------------------------------------------------------ */

  const renderReview = () => {
    const currentImage =
      scannedImages[selectedPage];

    if (!currentImage) {
      return (
        <View style={styles.emptyReview}>
          <Ionicons
            name="document-outline"
            size={56}
            color="#CBD5E1"
          />

          <Text style={styles.emptyTitle}>
            No pages scanned
          </Text>

          <Text style={styles.emptySubtitle}>
            Scan a document to continue.
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={captureDocument}
            accessibilityRole="button"
            accessibilityLabel="Scan document"
          >
            <Ionicons
              name="scan-outline"
              size={22}
              color="#fff"
            />

            <Text style={styles.primaryButtonText}>
              Scan Document
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    const quality = getQualityStatus(
      currentImage.width,
      currentImage.height
    );

    return (
      <View style={styles.reviewContainer}>
        <View style={styles.reviewHeader}>
          <View>
            <Text style={styles.reviewTitle}>
              Review Scan
            </Text>

            <Text style={styles.reviewSubtitle}>
              {scannedImages.length}{" "}
              {scannedImages.length === 1
                ? "page"
                : "pages"}{" "}
              scanned
            </Text>
          </View>

          <TouchableOpacity
            style={styles.headerCloseButton}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close scanner"
          >
            <Ionicons
              name="close"
              size={25}
              color="#fff"
            />
          </TouchableOpacity>
        </View>

        <View style={styles.previewContainer}>
          <Image
            source={{ uri: currentImage.uri }}
            style={styles.previewImage}
            resizeMode="contain"
            accessibilityLabel={`Scanned page ${
              selectedPage + 1
            }`}
          />

          <View style={styles.pageIndicator}>
            <Text style={styles.pageIndicatorText}>
              Page {selectedPage + 1} of{" "}
              {scannedImages.length}
            </Text>
          </View>

          <View style={styles.qualityBadge}>
            <Ionicons
              name={
                quality === "low-resolution"
                  ? "warning-outline"
                  : "checkmark-circle-outline"
              }
              size={17}
              color={
                quality === "low-resolution"
                  ? "#FBBF24"
                  : "#86EFAC"
              }
            />

            <Text
              style={[
                styles.qualityText,
                quality === "low-resolution" &&
                  styles.qualityWarningText,
              ]}
            >
              {quality === "low-resolution"
                ? "Low resolution"
                : `${currentImage.width} × ${currentImage.height}`}
            </Text>
          </View>
        </View>

        <View style={styles.thumbnailSection}>
          <View style={styles.thumbnailHeader}>
            <Text style={styles.thumbnailTitle}>
              Pages
            </Text>

            <Text style={styles.thumbnailHint}>
              Tap a page to preview
            </Text>
          </View>

          <FlatList
            horizontal
            data={scannedImages}
            keyExtractor={(item, index) =>
              `${item.uri}-${index}`
            }
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={
              styles.thumbnailList
            }
            renderItem={({
              item,
              index,
            }) => {
              const isSelected =
                selectedPage === index;

              return (
                <TouchableOpacity
                  style={[
                    styles.thumbnailWrapper,
                    isSelected &&
                      styles.thumbnailSelected,
                  ]}
                  onPress={() =>
                    setSelectedPage(index)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Page ${
                    index + 1
                  }`}
                >
                  <Image
                    source={{
                      uri: item.uri,
                    }}
                    style={styles.thumbnailImage}
                    resizeMode="cover"
                  />

                  <View
                    style={styles.thumbnailNumber}
                  >
                    <Text
                      style={
                        styles.thumbnailNumberText
                      }
                    >
                      {index + 1}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.thumbnailDelete}
                    onPress={() =>
                      handleDeletePage(index)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Delete page ${
                      index + 1
                    }`}
                  >
                    <Ionicons
                      name="close"
                      size={14}
                      color="#fff"
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleRetakeCurrentPage}
            accessibilityRole="button"
            accessibilityLabel="Retake current page"
          >
            <Ionicons
              name="camera-reverse-outline"
              size={21}
              color="#fff"
            />

            <Text style={styles.secondaryButtonText}>
              Retake
            </Text>
          </TouchableOpacity>

          {selectedPage > 0 && (
            <TouchableOpacity
              style={styles.iconActionButton}
              onPress={() =>
                movePage(
                  selectedPage,
                  selectedPage - 1
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Move page left"
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
          )}

          {selectedPage <
            scannedImages.length - 1 && (
            <TouchableOpacity
              style={styles.iconActionButton}
              onPress={() =>
                movePage(
                  selectedPage,
                  selectedPage + 1
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Move page right"
            >
              <Ionicons
                name="chevron-forward"
                size={22}
                color="#fff"
              />
            </TouchableOpacity>
          )}

          {scannedImages.length <
            MAX_PAGES && (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={captureDocument}
              accessibilityRole="button"
              accessibilityLabel="Add another page"
            >
              <Ionicons
                name="add"
                size={21}
                color="#fff"
              />

              <Text
                style={styles.secondaryButtonText}
              >
                Add Page
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleUseScan}
          accessibilityRole="button"
          accessibilityLabel="Use scanned document"
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={22}
            color="#fff"
          />

          <Text style={styles.primaryButtonText}>
            Use Scan
          </Text>
        </TouchableOpacity>

        <Text style={styles.reviewFooter}>
          Review all pages before continuing to OCR
          and document autofill.
        </Text>
      </View>
    );
  };

  /* ------------------------------------------------------------------------ */
  /*                        SCANNING UI                                       */
  /* ------------------------------------------------------------------------ */

  const renderScanningState = () => {
    let icon:
      | "scan-outline"
      | "camera-outline"
      | "sync-outline" =
      "scan-outline";

    let title = "Preparing scanner...";
    let subtitle =
      "Get your document ready";

    if (phase === "capturing") {
      icon = "camera-outline";
      title = "Scanning document...";
      subtitle =
        "Hold your device steady and keep all document edges visible";
    }

    if (phase === "processing") {
      icon = "sync-outline";
      title = "Processing scan...";
      subtitle =
        "Checking image quality and resolution";
    }

    return (
      <View
        style={styles.stabilizationContent}
      >
        <View style={styles.guidanceBox}>
          <View style={styles.scannerIconCircle}>
            <Ionicons
              name={icon}
              size={40}
              color="#fff"
            />
          </View>

          <Text style={styles.instructionTitle}>
            {title}
          </Text>

          <Text style={styles.instructionSubtitle}>
            {subtitle}
          </Text>

          {phase === "capturing" && (
            <>
              <View style={styles.holdSteadyBadge}>
                <Ionicons
                  name="hand-left-outline"
                  size={18}
                  color="#fff"
                />

                <Text
                  style={
                    styles.holdSteadyText
                  }
                >
                  Hold steady
                </Text>
              </View>

              <View
                style={styles.scanTipsContainer}
              >
                <View
                  style={styles.tipRow}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={18}
                    color="#86EFAC"
                  />

                  <Text
                    style={styles.tipText}
                  >
                    Keep all edges visible
                  </Text>
                </View>

                <View
                  style={styles.tipRow}
                >
                  <Ionicons
                    name="sunny-outline"
                    size={18}
                    color="#FDE68A"
                  />

                  <Text
                    style={styles.tipText}
                  >
                    Avoid glare and shadows
                  </Text>
                </View>

                <View
                  style={styles.tipRow}
                >
                  <Ionicons
                    name="resize-outline"
                    size={18}
                    color="#93C5FD"
                  />

                  <Text
                    style={styles.tipText}
                  >
                    Fill the frame
                  </Text>
                </View>
              </View>
            </>
          )}

          <ActivityIndicator
            color="#fff"
            size="small"
            style={styles.activityIndicator}
          />
        </View>

        <View style={styles.scanProgressContainer}>
          <View style={styles.scanProgressTrack}>
            <Animated.View
              style={styles.scanProgressBar}
            />
          </View>

          <Text style={styles.scanProgressText}>
            Scan attempt {scanAttempt || 1}
          </Text>
        </View>
      </View>
    );
  };

  /* ------------------------------------------------------------------------ */
  /*                            SUCCESS UI                                    */
  /* ------------------------------------------------------------------------ */

  const renderSuccess = () => (
    <View style={styles.stabilizationContent}>
      <View style={styles.successBox}>
        <View style={styles.successIconCircle}>
          <Ionicons
            name="checkmark"
            size={48}
            color="#fff"
          />
        </View>

        <Text style={styles.instructionTitle}>
          Scan Successful
        </Text>

        <Text style={styles.instructionSubtitle}>
          {scannedImages.length}{" "}
          {scannedImages.length === 1
            ? "page"
            : "pages"}{" "}
          captured successfully
        </Text>

        <ActivityIndicator
          color="#fff"
          size="small"
          style={styles.activityIndicator}
        />
      </View>
    </View>
  );

  /* ------------------------------------------------------------------------ */
  /*                                RENDER                                    */
  /* ------------------------------------------------------------------------ */

  if (!visibleState) {
    return null;
  }

  return (
    <Modal
      visible={true}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      <Animated.View
        style={[
          styles.modalOverlay,
          {
            transform: [
              {
                translateY: slideAnim,
              },
            ],
          },
        ]}
        {...panResponder.panHandlers}
      >
        {phase === "review"
          ? renderReview()
          : phase === "success"
          ? renderSuccess()
          : renderScanningState()}

        {phase !== "review" &&
          phase !== "success" && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
              disabled={scanning}
              hitSlop={{
                top: 20,
                bottom: 20,
                left: 20,
                right: 20,
              }}
              accessibilityRole="button"
              accessibilityLabel="Close scanner"
            >
              <View
                style={[
                  styles.closeButtonInner,
                  scanning &&
                    styles.closeButtonDisabled,
                ]}
              >
                <Ionicons
                  name="close"
                  size={28}
                  color="#fff"
                />

                <Text style={styles.closeLabel}>
                  Cancel
                </Text>
              </View>
            </TouchableOpacity>
          )}
      </Animated.View>
    </Modal>
  );
};

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.94)",
    justifyContent: "flex-end",
  },

  /* ------------------------------ SCANNING -------------------------------- */

  stabilizationContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  guidanceBox: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderRadius: 24,
    paddingHorizontal: 26,
    paddingVertical: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },

  scannerIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },

  instructionTitle: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "700",
    marginTop: 16,
    textAlign: "center",
  },

  instructionSubtitle: {
    color: "#CBD5E1",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
    marginTop: 8,
    textAlign: "center",
  },

  holdSteadyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },

  holdSteadyText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  scanTipsContainer: {
    width: "100%",
    marginTop: 22,
    gap: 10,
  },

  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  tipText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },

  activityIndicator: {
    marginTop: 22,
  },

  scanProgressContainer: {
    width: "100%",
    maxWidth: 420,
    marginTop: 20,
    alignItems: "center",
  },

  scanProgressTrack: {
    width: "80%",
    height: 4,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    overflow: "hidden",
  },

  scanProgressBar: {
    width: "55%",
    height: "100%",
    borderRadius: 4,
    backgroundColor: "#fff",
  },

  scanProgressText: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 8,
  },

  /* ------------------------------- REVIEW -------------------------------- */

  reviewContainer: {
    flex: 1,
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },

  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },

  reviewTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
  },

  reviewSubtitle: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 3,
  },

  headerCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },

  previewContainer: {
    flex: 1,
    minHeight: 300,
    maxHeight: SCREEN_WIDTH * 1.25,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },

  previewImage: {
    width: "100%",
    height: "100%",
  },

  pageIndicator: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(0, 0, 0, 0.68)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
  },

  pageIndicatorText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  qualityBadge: {
    position: "absolute",
    right: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 0, 0, 0.68)",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
  },

  qualityText: {
    color: "#86EFAC",
    fontSize: 11,
    fontWeight: "700",
  },

  qualityWarningText: {
    color: "#FBBF24",
  },

  thumbnailSection: {
    marginTop: 14,
  },

  thumbnailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  thumbnailTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  thumbnailHint: {
    color: "#64748B",
    fontSize: 12,
  },

  thumbnailList: {
    gap: 10,
    paddingVertical: 4,
  },

  thumbnailWrapper: {
    width: REVIEW_THUMBNAIL_SIZE,
    height: REVIEW_THUMBNAIL_SIZE,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#1E293B",
    position: "relative",
  },

  thumbnailSelected: {
    borderColor: "#fff",
  },

  thumbnailImage: {
    width: "100%",
    height: "100%",
  },

  thumbnailNumber: {
    position: "absolute",
    left: 5,
    bottom: 5,
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },

  thumbnailNumberText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

  thumbnailDelete: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(220, 38, 38, 0.9)",
  },

  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },

  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },

  secondaryButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },

  iconActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },

  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 52,
    marginTop: 12,
    borderRadius: 26,
    backgroundColor: COLORS.primary || "#2563EB",
    paddingHorizontal: 20,
  },

  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },

  reviewFooter: {
    color: "#64748B",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
  },

  emptyReview: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },

  emptyTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 16,
  },

  emptySubtitle: {
    color: "#94A3B8",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 20,
  },

  /* ------------------------------- SUCCESS ------------------------------- */

  successBox: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.96)",
    borderRadius: 24,
    paddingHorizontal: 26,
    paddingVertical: 32,
    borderWidth: 1,
    borderColor: "rgba(134, 239, 172, 0.22)",
  },

  successIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.success || "#16A34A",
  },

  /* ------------------------------- CLOSE --------------------------------- */

  closeButton: {
    alignSelf: "center",
    marginBottom: 38,
    padding: 10,
  },

  closeButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },

  closeButtonDisabled: {
    opacity: 0.5,
  },

  closeLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
