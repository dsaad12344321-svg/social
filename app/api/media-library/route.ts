import { getDriveClient, getDriveFolderId, getMediaUrl } from "@/lib/google-drive";

export const runtime = "nodejs";

type DriveMediaFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  createdTime?: string | null;
  appProperties?: Record<string, string> | null;
};

function isSupportedMedia(file: DriveMediaFile) {
  return !!file.id && !!file.name && !!file.mimeType &&
    (file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/"));
}

async function getOwnedMediaFile(fileId: string, folderId: string) {
  const drive = getDriveClient();
  const response = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,parents,trashed,appProperties",
    supportsAllDrives: true,
  });
  const file = response.data;
  if (!file.id || file.trashed || !file.parents?.includes(folderId) ||
      !file.mimeType ||
      !(file.mimeType.startsWith("image/") || file.mimeType.startsWith("video/"))) {
    return null;
  }
  return file;
}

export async function GET(): Promise<Response> {
  try {
    const drive = getDriveClient();
    const folderId = getDriveFolderId();

    if (!folderId) {
      return Response.json(
        { success: false, error: "GOOGLE_DRIVE_FOLDER_ID is not configured." },
        { status: 500 }
      );
    }

    const files: DriveMediaFile[] = [];
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: "'" + folderId + "' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')",
        pageSize: 1000,
        pageToken,
        orderBy: "createdTime desc",
        fields: "nextPageToken,files(id,name,mimeType,size,createdTime,appProperties)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      if (Array.isArray(response.data.files)) {
        files.push(...response.data.files);
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return Response.json({
      success: true,
      files: files.filter(isSupportedMedia).map((file) => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        size: file.size || null,
        createdTime: file.createdTime || null,
        pinned: file.appProperties?.socialPinned === "true",
        url: getMediaUrl(file.id!),
        mediaType: file.mimeType!.startsWith("video/") ? "video" : "image",
      })),
    });
  } catch (error) {
    console.error("Google Drive media library error:", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to load Google Drive media library.",
    }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const action = body?.action;
    const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";

    if (!fileId || (action !== "delete" && action !== "pin")) {
      return Response.json(
        { success: false, error: "Invalid media library action." },
        { status: 400 }
      );
    }

    const drive = getDriveClient();
    const folderId = getDriveFolderId();

    if (!folderId) {
      return Response.json(
        { success: false, error: "GOOGLE_DRIVE_FOLDER_ID is not configured." },
        { status: 500 }
      );
    }

    const file = await getOwnedMediaFile(fileId, folderId);

    if (!file) {
      return Response.json(
        { success: false, error: "Media file was not found." },
        { status: 404 }
      );
    }

    if (action === "delete") {
      await drive.files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
      return Response.json({ success: true, action: "delete", fileId });
    }

    const pinned = body?.pinned === true;
    await drive.files.update({
      fileId,
      requestBody: { appProperties: { socialPinned: pinned ? "true" : "false" } },
      supportsAllDrives: true,
    });

    return Response.json({ success: true, action: "pin", fileId, pinned });
  } catch (error) {
    console.error("Google Drive media library action error:", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update media library.",
    }, { status: 500 });
  }
}
