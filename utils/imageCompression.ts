import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: ImageManipulator.SaveFormat;
  compress?: number;
}

export interface CompressedImageResult {
  uri: string;
  width: number;
  height: number;
  size: number;
  base64?: string;
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8,
  format: ImageManipulator.SaveFormat.JPEG,
  compress: 0.8,
};

export async function compressImage(
  uri: string,
  options: CompressionOptions = {}
): Promise<CompressedImageResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    const originalInfo = await FileSystem.getInfoAsync(uri);
    const originalSize = originalInfo.size || 0;

    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [
        { resize: { width: opts.maxWidth, height: opts.maxHeight } },
      ],
      {
        compress: opts.compress,
        format: opts.format,
        base64: false,
      }
    );

    const compressedInfo = await FileSystem.getInfoAsync(resized.uri);
    const compressedSize = compressedInfo.size || 0;

    const savings = originalSize > 0
      ? Math.round(((originalSize - compressedSize) / originalSize) * 100)
      : 0;

    return {
      uri: resized.uri,
      width: resized.width,
      height: resized.height,
      size: compressedSize,
    };
  } catch (error) {
    console.error("Image compression failed:", error);
    return {
      uri,
      width: 0,
      height: 0,
      size: 0,
    };
  }
}

export async function compressMultipleImages(
  uris: string[],
  options: CompressionOptions = {}
): Promise<CompressedImageResult[]> {
  const results: CompressedImageResult[] = [];
  
  for (const uri of uris) {
    const result = await compressImage(uri, options);
    results.push(result);
  }
  
  return results;
}

export function getFileSizeMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  try {
    const result = await ImageManipulator.manipulateAsync(uri, [], { format: ImageManipulator.SaveFormat.JPEG });
    return { width: result.width, height: result.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

export async function rotateImage(uri: string, degrees: 90 | 180 | 270): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ rotate: degrees }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
  );
  return result.uri;
}

export async function cropImage(
  uri: string,
  crop: { x: number; y: number; width: number; height: number }
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
  );
  return result.uri;
}