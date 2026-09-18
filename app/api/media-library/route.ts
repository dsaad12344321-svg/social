import { getDriveClient, getDriveFolderId, getMediaUrl } from "@/lib/google-drive";

export const runtime = "nodejs";

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

    const files: Array<{
      id?: string | null;
      name?: string | null;
      mimeType?: string | null;
      size?: string | null;
      createdTime?: string | null;
    }> = [];

    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
        pageSize: 1000,
        pageToken,
        orderBy: "createdTime desc",
        fields: "nextPageToken,files(id,name,mimeType,size,createdTime)",
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
      files: files
        .filter((file) => file.id && file.name && file.mimeType)
        .map((file) => ({
          id: file.id!,
          name: file.name!,
          mimeType: file.mimeType!,
          size: file.size || null,
          createdTime: file.createdTime || null,
          url: getMediaUrl(file.id!),
          mediaType: file.mimeType!.startsWith("video/") ? "video" : "image",
        })),
    });
  } catch (error) {
    console.error("Google Drive media library error:", error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Failed to load Google Drive media library.",
      },
      { status: 500 }
    );
  }
}
