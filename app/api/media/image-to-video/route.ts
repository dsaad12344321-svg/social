import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import {
  getDriveClient,
  getDriveFolderId,
  getMediaUrl,
} from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;

const VIDEO_DURATION_SECONDS = 5;

function jsonError(message: string, status = 400) {
  return Response.json(
    { success: false, error: message },
    { status }
  );
}

function getFileIdFromMediaUrl(mediaUrl: string, request: Request) {
  try {
    const parsed = new URL(mediaUrl, request.url);
    const prefix = "/api/media/";
    if (!parsed.pathname.startsWith(prefix)) return "";

    return decodeURIComponent(
      parsed.pathname.slice(prefix.length).split("/")[0]
    );
  } catch {
    return "";
  }
}

async function runFfmpeg(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const executablePath = ffmpegPath;

  if (!executablePath) {
    throw new Error("FFmpeg binary is not available.");
  }

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-y",
      "-loop",
      "1",
      "-i",
      inputPath,
      "-t",
      String(VIDEO_DURATION_SECONDS),
      "-r",
      "30",
      "-vf",
      "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      outputPath,
    ];

    const child = spawn(executablePath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();

      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `FFmpeg failed with code ${code}: ${stderr.trim() || "unknown error"}`
        )
      );
    });
  });
}

export async function POST(request: Request) {
  console.log("=== POST /api/media/image-to-video ===");
  let tempDir = "";

  try {
    const body = await request.json();
    const mediaUrl =
      typeof body?.mediaUrl === "string"
        ? body.mediaUrl.trim()
        : "";

    if (!mediaUrl) {
      return jsonError("mediaUrl is required.");
    }

    const fileId = getFileIdFromMediaUrl(mediaUrl, request);

    if (!fileId) {
      return jsonError(
        "The media URL must point to an existing /api/media/{fileId} image."
      );
    }

    const drive = getDriveClient();

    const metadataResponse = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size",
    });

    const sourceMimeType = metadataResponse.data.mimeType || "";

    if (!sourceMimeType.startsWith("image/")) {
      return jsonError("Only image files can be converted.", 400);
    }

    const sourceResponse = await drive.files.get(
      {
        fileId,
        alt: "media",
      },
      {
        responseType: "arraybuffer",
      }
    );

    const inputBuffer = Buffer.from(sourceResponse.data as ArrayBuffer);

    if (!inputBuffer.length) {
      return jsonError("The source image is empty.", 400);
    }

    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "daleelak-image-video-")
    );

    const extension =
      sourceMimeType === "image/png"
        ? ".png"
        : sourceMimeType === "image/webp"
        ? ".webp"
        : sourceMimeType === "image/gif"
        ? ".gif"
        : ".jpg";

    const inputPath = path.join(tempDir, `source${extension}`);
    const outputPath = path.join(tempDir, "converted.mp4");

    await fs.writeFile(inputPath, inputBuffer);
    await runFfmpeg(inputPath, outputPath);

    const outputBuffer = await fs.readFile(outputPath);

    if (!outputBuffer.length) {
      throw new Error("FFmpeg produced an empty video.");
    }

    const folderId = getDriveFolderId();

    const uploadMetadata: {
      name: string;
      mimeType: string;
      parents?: string[];
    } = {
      name: `notify-me-${randomUUID()}.mp4`,
      mimeType: "video/mp4",
    };

    if (folderId) {
      uploadMetadata.parents = [folderId];
    }

    const uploaded = await drive.files.create({
      requestBody: uploadMetadata,
      media: {
        mimeType: "video/mp4",
        body: Readable.from(outputBuffer),
      },
      fields: "id,name,mimeType,size",
    });

    const convertedFileId = uploaded.data.id;

    if (!convertedFileId) {
      throw new Error(
        "Google Drive did not return the converted video file ID."
      );
    }

    return Response.json({
      success: true,
      fileId: convertedFileId,
      url: getMediaUrl(convertedFileId),
      mimeType: "video/mp4",
      duration: VIDEO_DURATION_SECONDS,
      sourceFileId: fileId,
      name: uploaded.data.name,
      size: uploaded.data.size,
    });
  } catch (error) {
    console.error("Image to video conversion error:", error);

    return jsonError(
      error instanceof Error
        ? error.message
        : "Failed to convert image to video.",
      500
    );
  } finally {
    if (tempDir) {
      await fs
        .rm(tempDir, {
          recursive: true,
          force: true,
        })
        .catch(() => undefined);
    }
  }
}
