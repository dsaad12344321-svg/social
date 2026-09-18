"use client";

import { useEffect, useMemo, useState } from "react";



type Source = "certificates" | "deposits" | "treasury";

type Platform =
| "Facebook"
| "Instagram"
| "TikTok"
| "X"
| "YouTube";

type BufferRateLimit = {
windowSeconds: number;
quota: number;
remaining: number;
resetSeconds: number;
};

type BufferAccount = {
account: number;
accountName?: string | null;
accountEmail?: string | null;
accountAvatar?: string | null;
rateLimits?: {
fifteenMinutes?: BufferRateLimit;
oneDay?: BufferRateLimit;
thirtyDays?: BufferRateLimit;
};
organizations: Array<{
id: string;
name: string;
ownerEmail?: string;
channels: BufferChannel[];
}>;
};

type BufferChannel = {
id: string;
name: string;
displayName?: string | null;
service: string;
avatar?: string | null;
isQueuePaused?: boolean;
isDisconnected?: boolean;
isLocked?: boolean;
account: number;
organizationId: string;
organizationName: string;
ownerEmail?: string;
};

type BufferChannelsResponse = {
success: boolean;
accounts: BufferAccount[];
channels: BufferChannel[];
errors?: Array<{
account: number;
error: string;
}>;
};

type Status = "draft" | "scheduled" | "published" | "failed";

type MediaType = "image" | "video";

type DriveMedia = {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  createdTime?: string | null;
  url: string;
  mediaType: MediaType;
  pinned: boolean;
};

type Post = {
id: string;
source: Source;
title: string;
caption: string;
media: string;
mediaType: MediaType;
platforms: Platform[];
channelIds: string[];
status: Status;
createdAt: string;
error?: string;
};

const STORAGE = "daleelak-social-posts-v3";

const BANKS_URL = "https://daleelakelbanky.vercel.app";

const generators: Record<
Source,
{
label: string;
path: string;
}
>
= {
certificates: {
label: "منشئ الشهادات",
path: "/certificates-poster",
},
deposits: {
label: "منشئ الودائع",
path: "/deposits-poster",
},
treasury: {
label: "منشئ أذون الخزانة",
path: "/treasury-bills-poster",
},
};

function titleFor(source: Source) {
if (source === "certificates") {
return "شهادات البنوك المصرية";
}

if (source === "deposits") {
return "ودائع البنوك المصرية";
}

return "أذون الخزانة المصرية";
}

function normalizePlatform(service: string): Platform | null {
const value = service.toLowerCase().trim();

if (value === "facebook") {
return "Facebook";
}

if (value === "instagram") {
return "Instagram";
}

if (value === "tiktok") {
return "TikTok";
}

if (value === "twitter" || value === "x") {
return "X";
}

if (value === "youtube") {
return "YouTube";
}

return null;
}

export default function Dashboard() {
const [posts, setPosts] = useState<Post[]>([]);
const [caption, setCaption] = useState("");
const [media, setMedia] = useState("");
const [mediaType, setMediaType] = useState<MediaType>("image");
const [source, setSource] = useState<Source>("certificates");

const [uploadingMedia, setUploadingMedia] = useState(false);

const [platforms, setPlatforms] = useState<Platform[]>([
"Facebook",
]);

const [section, setSection] = useState("Dashboard");
const [uploading, setUploading] = useState(false);
const [publishingId, setPublishingId] = useState<string | null>(null);

const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>(
[]
);

const [bufferAccounts, setBufferAccounts] = useState<BufferAccount[]>([]);

const [loadingChannels, setLoadingChannels] = useState(false);

const [mediaLibrary, setMediaLibrary] = useState<DriveMedia[]>([]);
const [loadingMediaLibrary, setLoadingMediaLibrary] = useState(false);
const [mediaLibraryRefresh, setMediaLibraryRefresh] = useState(0);
const [mediaView, setMediaView] = useState<"small" | "medium" | "large">("medium");
const [mediaActionId, setMediaActionId] = useState<string | null>(null);

async function handleMediaUpload(
  event: React.ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  if (
    !file.type.startsWith("image/") &&
    !file.type.startsWith("video/")
  ) {
    alert(
      "من فضلك اختر صورة أو فيديو فقط"
    );

    event.target.value = "";
    return;
  }

  const detectedType: MediaType =
    file.type.startsWith("video/")
      ? "video"
      : "image";

  if (
    platforms.includes("YouTube") &&
    detectedType !== "video"
  ) {
    alert(
      "عند اختيار YouTube يجب رفع فيديو"
    );

    event.target.value = "";
    return;
  }

  const MAX_FILE_SIZE =
    500 * 1024 * 1024;

  if (file.size > MAX_FILE_SIZE) {    alert(
      "حجم الملف يجب ألا يتجاوز 500 MB"
    );

    event.target.value = "";
    return;
  }

  setUploadingMedia(true);

  try {
    console.log(
      "=== GOOGLE DRIVE UPLOAD START ==="
    );

    console.log({
      name: file.name,
      type: file.type,
      size: file.size,
      sizeMB: (
        file.size /
        1024 /
        1024
      ).toFixed(2),
    });

    /*
     * --------------------------------------------------
     * STEP 1
     *
     * Ask our server to create a Google Drive
     * resumable upload session.
     * --------------------------------------------------
     */
    const initResponse =
      await fetch("/api/upload", {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          name: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });

    const initData =
      await initResponse.json();

    if (
      !initResponse.ok ||
      !initData.success ||
      !initData.sessionUrl
    ) {
      throw new Error(
        initData.error ||
          "فشل إنشاء جلسة رفع Google Drive"
      );
    }

    const sessionUrl =
      initData.sessionUrl;

    if (!initData.uploadId) {
      throw new Error(
        "فشل إنشاء معرف رفع Google Drive"
      );
    }

    /*
     * --------------------------------------------------
     * STEP 2
     *
     * Upload the file directly from the browser
     * to Google Drive.
     *
     * The 500 MB file does NOT pass through Next.js.
     * --------------------------------------------------
     */
    let googleUploadError: unknown = null;

try {
  const uploadResponse =
    await fetch(sessionUrl, {
      method: "PUT",

      headers: {
        "Content-Type":
          file.type,
      },

      body: file,
    });

  console.log(
    "Google Drive upload response status:",
    uploadResponse.status
  );

  if (!uploadResponse.ok) {
    const errorText =
      await uploadResponse.text();

    console.error(
      "Google Drive upload failed:",
      uploadResponse.status,
      errorText
    );

    googleUploadError =
      new Error(
        `فشل رفع الملف إلى Google Drive (${uploadResponse.status})`
      );
  }
} catch (error) {
  console.warn(
    "Google Drive response could not be read. Looking up uploaded file...",
    error
  );

  googleUploadError = error;
}

let uploadedFile: any = null;

/*
 * Google Drive may need extra time to finalize/index
 * large video files after the upload request completes.
 *
 * We keep checking through our same-origin Next.js API
 * instead of asking the browser to read Google's
 * cross-origin upload response.
 *
 * 30 attempts × 2 seconds = up to 60 seconds.
 */
const MAX_LOOKUP_ATTEMPTS = 30;
const LOOKUP_DELAY_MS = 2000;

for (
  let attempt = 0;
  attempt < MAX_LOOKUP_ATTEMPTS;
  attempt++
) {
  try {
    const lookupResponse =
      await fetch("/api/upload", {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          action: "find",
          uploadId: initData.uploadId,
        }),
      });

    const lookupData =
      await lookupResponse.json();

    console.log(
      "Google Drive lookup attempt:",
      attempt + 1,
      "/",
      MAX_LOOKUP_ATTEMPTS,
      lookupData
    );

    if (
      lookupResponse.ok &&
      lookupData.success &&
      lookupData.found &&
      lookupData.fileId
    ) {
      uploadedFile =
        lookupData;

      break;
    }
  } catch (error) {
    console.warn(
      "Google Drive lookup attempt failed:",
      error
    );
  }

  if (
    attempt <
    MAX_LOOKUP_ATTEMPTS - 1
  ) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        LOOKUP_DELAY_MS      )
    );
  }
}

const fileId =
  uploadedFile?.fileId;

if (!fileId) {
  throw new Error(
    googleUploadError
      ? "تم رفع الملف أو محاولة رفعه إلى Google Drive، ولكن تعذر العثور عليه بعد الرفع."
      : "تم رفع الملف إلى Google Drive، ولكن تعذر العثور على File ID."
  );
}

    /*
     * Our application does not expose the Google
     * Drive URL directly.
     *
     * Instead it uses:
     *
     * /api/media/{fileId}
     */
    const mediaUrl =
      new URL(
        `/api/media/${encodeURIComponent(fileId)}`,
        window.location.origin
      ).toString();

    console.log(
      "=== GOOGLE DRIVE UPLOAD SUCCESS ==="
    );

    console.log({
      fileId,
      mediaUrl,
      name:
        uploadedFile?.name,
      mimeType:
        uploadedFile?.mimeType,
    });

    setMedia(mediaUrl);
    setMediaType(detectedType);

    alert(
      detectedType === "video"
        ? "تم رفع الفيديو بنجاح"
        : "تم رفع الصورة بنجاح"
    );
  } catch (error) {
    console.error(
      "Google Drive media upload error:",
      error
    );

    alert(
      error instanceof Error
        ? error.message
        : "فشل رفع الملف"
    );
  } finally {
    setUploadingMedia(false);

    event.target.value = "";
  }
}

const availablePlatforms = useMemo(() => {
return Array.from(
new Set(
bufferChannels
.filter(
(channel) =>
!channel.isDisconnected &&
!channel.isLocked
)
.map((channel) =>
normalizePlatform(channel.service)
)
.filter(
(platform): platform is Platform =>
platform !== null
)
)
);
}, [bufferChannels]);

function getChannelIdsForPlatforms(
selectedPlatforms: Platform[]
) {
return bufferChannels
.filter(
(channel) =>
!channel.isDisconnected &&
!channel.isLocked
)
.filter((channel) => {
const normalized = normalizePlatform(
channel.service
);

    return (
      normalized !== null &&
      selectedPlatforms.includes(normalized)
    );
  })
  .map((channel) => channel.id);

}

useEffect(() => {
  if (section !== "Content") {
    return;
  }

  async function loadMediaLibrary() {
    setLoadingMediaLibrary(true);

    try {
      const response = await fetch("/api/media-library", {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || "فشل تحميل مكتبة الوسائط");
      }

      setMediaLibrary(Array.isArray(data.files) ? data.files : []);
    } catch (error) {
      console.error("Media library error:", error);
      setMediaLibrary([]);
    } finally {
      setLoadingMediaLibrary(false);
    }
  }

  loadMediaLibrary();
}, [section, mediaLibraryRefresh]);

useEffect(() => {
async function loadBufferChannels() {
setLoadingChannels(true);

  try {
    const response = await fetch(
      "/api/buffer/channels",
      {
        cache: "no-store",
      }
    );

    const data =
      (await response.json()) as BufferChannelsResponse;

    if (!response.ok || !data.success) {
      throw new Error(
        data?.errors?.[0]?.error ||
          "فشل تحميل حسابات Buffer"
      );
    }

    const channels = Array.isArray(data.channels)
      ? data.channels
      : [];

    const accounts = Array.isArray(data.accounts)
      ? data.accounts
      : [];

    setBufferChannels(channels);
    setBufferAccounts(accounts);
  } catch (error) {
    console.error(
      "Buffer channels error:",
      error
    );
  } finally {
    setLoadingChannels(false);
  }
}

loadBufferChannels();

}, []);

useEffect(() => {
try {
const raw = localStorage.getItem(STORAGE);

  if (!raw) {
    return;
  }

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    return;
  }

  const migratedPosts: Post[] = parsed
    .filter(
      (post) =>        post &&
        typeof post === "object" &&
        typeof post.id === "string"
    )
    .map((post) => ({
      ...post,
      media:
        typeof post.media === "string"
          ? post.media
          : typeof post.image === "string"
          ? post.image
          : "",
      mediaType:
        post.mediaType === "video"
          ? "video"
          : "image",
      platforms: Array.isArray(post.platforms)
        ? post.platforms
        : ["Facebook"],
      channelIds: Array.isArray(post.channelIds)
        ? post.channelIds
        : [],
    }));

  setPosts(migratedPosts);
} catch (error) {
  console.error(
    "Failed to load posts:",
    error
  );
}

}, []);

useEffect(() => {
try {
localStorage.setItem(
STORAGE,
JSON.stringify(posts)
);
} catch (error) {
console.error(
"Failed to save posts:",
error
);
}
}, [posts]);

useEffect(() => {
  const onMessage = async (
    event: MessageEvent
  ) => {
    const data = event.data;

    if (
      !data ||
      data.type !== "DALEELAK_SOCIAL_POST"
    ) {
      return;
    }

    const incomingSource: Source =
      data.source === "treasury" ||
      data.source === "deposits"
        ? data.source
        : "certificates";

    const incomingCaption =
      typeof data.caption === "string"
        ? data.caption
        : "";

      const incomingImage =
        typeof data.image === "string"
          ? data.image
          : "";
          
    console.log("DALEELAK data.image:", data.image);
    console.log("DALEELAK incomingImage:", incomingImage);
    setSource(incomingSource);
    setCaption(incomingCaption);
    setSection("Content");

    if (!incomingImage) {
      return;
    }

setUploading(true);

try {
  const uploadResponse =
    await fetch("/api/upload", {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        media: incomingImage,
      }),
    });

  const uploadData =
    await uploadResponse.json();

  if (
    !uploadResponse.ok ||
    !uploadData.success ||
    !uploadData.fileId
  ) {
    throw new Error(
      uploadData.error ||
        "فشل رفع صورة Generator إلى Google Drive"
    );
  }

  const mediaUrl =
    new URL(
      `/api/media/${encodeURIComponent(
        uploadData.fileId
      )}`,
      window.location.origin
    ).toString();

  console.log(
    "=== GENERATOR GOOGLE DRIVE UPLOAD SUCCESS ==="
  );

  console.log({
    fileId:
      uploadData.fileId,
    mediaUrl,
    name:
      uploadData.name,
    mimeType:
      uploadData.mimeType,
  });

  setMedia(mediaUrl);
  setMediaType("image");

} catch (error) {
  console.error(
    "Image upload failed:",
    error
  );

  alert(
    error instanceof Error
      ? error.message
      : "فشل رفع الصورة"
  );
} finally {
  setUploading(false);
}
};
    

  window.addEventListener(
    "message",
    onMessage
  );

  return () => {
    window.removeEventListener(
      "message",
      onMessage
    );
  };
}, []);

const stats = useMemo(
() => ({
drafts: posts.filter(
(post) => post.status === "draft"
).length,

  scheduled: posts.filter(
    (post) => post.status === "scheduled"
  ).length,

  published: posts.filter(
    (post) => post.status === "published"
  ).length,

  failed: posts.filter(
    (post) => post.status === "failed"
  ).length,
}),
[posts]

);

function openGenerator(
selectedSource: Source
) {
setSource(selectedSource);
window.open(
  BANKS_URL +
    generators[selectedSource].path,
  "_blank",
  "width=1450,height=1000"
);

}

function togglePlatform(
platform: Platform
) {
const isSelected =
platforms.includes(platform);

if (isSelected) {
  const nextPlatforms =
    platforms.filter(
      (item) => item !== platform
    );

  setPlatforms(nextPlatforms);
  return;
}

if (
  platform === "YouTube" &&
  media &&
  mediaType !== "video"
) {
  alert(
    "YouTube يحتاج فيديو. استخدم زر Upload لرفع فيديو."
  );
  return;
}

setPlatforms([
  ...platforms,
  platform,
]);

}

function createPost() {
if (!media) {
alert(
"يرجى رفع صورة أو فيديو أولًا"
);
return;
}

if (!caption.trim()) {
  alert(
    "يرجى كتابة Caption أولًا"
  );
  return;
}

if (platforms.length === 0) {
  alert(
    "اختر منصة واحدة على الأقل"
  );
  return;
}

if (
  platforms.includes("YouTube") &&
  mediaType !== "video"
) {
  alert(
    "YouTube يحتاج فيديو"
  );
  return;
}

const channelIds =
  getChannelIdsForPlatforms(
    platforms
  );

if (channelIds.length === 0) {
  alert(
    "لم يتم العثور على حساب Buffer للمنصات المختارة"
  );
  return;
}

const post: Post = {
  id: crypto.randomUUID(),
  source,
  title: titleFor(source),
  caption: caption.trim(),
  media,
  mediaType,
  platforms: [...platforms],
  channelIds,
  status: "draft",
  createdAt: new Date().toISOString(),
};

setPosts((current) => [
  post,
  ...current,
]);

setCaption("");
setMedia("");
setMediaType("image");

}

async function getVideoDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      video.removeAttribute("src");
      video.load();

      if (!Number.isFinite(duration) || duration < 0) {
        reject(new Error("تعذر معرفة مدة الفيديو"));
        return;
      }

      resolve(duration);
    };
    video.onerror = () => {
      video.removeAttribute("src");
      video.load();
      reject(new Error("تعذر قراءة مدة الفيديو"));
    };
    video.src = videoUrl;
  });
}

async function publishPost(
post: Post
) {
if (!post.media) {
alert(
"لا توجد صورة أو فيديو لهذا المنشور"
);
return;
}

if (!post.caption.trim()) {
  alert(
    "لا يوجد Caption لهذا المنشور"
  );
  return;
}

if (
  !post.channelIds ||
  post.channelIds.length === 0
) {
  alert(
    "لم يتم العثور على حساب Buffer للمنصات المختارة"
  );
  return;
}

if (
  post.platforms.includes("YouTube") &&
  post.mediaType !== "video"
) {
  alert(
    "منشور YouTube يجب أن يحتوي على فيديو"
  );
  return;
}

setPublishingId(post.id);

try {
  let videoDuration: number | undefined;

  if (post.mediaType === "video") {
    videoDuration = await getVideoDuration(post.media);
    console.log("=== VIDEO DURATION ===", videoDuration);
  }

  const response = await fetch(
    "/api/buffer/publish",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageUrl:
          post.mediaType === "image"
            ? post.media
            : undefined,

        videoUrl:
          post.mediaType === "video"
            ? post.media
            : undefined,

        videoDuration,

        caption: post.caption,

        channelIds:
          post.channelIds,

        source: post.source,
      }),
    }
  );

  const data =
    await response.json();

  if (
    !response.ok ||
    (!data.success &&
      !data.partialSuccess)
  ) {
    throw new Error(
      data?.error ||
        "فشل نشر المنشور عبر Buffer"
    );
  }

  setPosts((current) =>
    current.map((item) =>
      item.id === post.id
        ? {
            ...item,
            status:
              data.partialSuccess                ? "failed"
                : "published",
            error:
              data.partialSuccess
                ? `تم النشر على ${data.published} من ${data.total} حسابات`
                : undefined,
          }
        : item
    )
  );

  if (data.partialSuccess) {
    alert(
      `تم النشر جزئيًا: ${data.published} من ${data.total} حسابات`
    );
  } else {
    alert(
      `تم نشر المنشور بنجاح على ${data.published} حسابات`
    );
  }

  console.log(
    "Buffer publish results:",
    data.results
  );
} catch (error) {
  console.error(
    "Publish error:",
    error
  );

  setPosts((current) =>
    current.map((item) =>
      item.id === post.id
        ? {
            ...item,
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "فشل نشر المنشور",
          }
        : item
    )
  );

  alert(
    error instanceof Error
      ? error.message
      : "فشل نشر المنشور"
  );
} finally {
  setPublishingId(null);
}

}

const sortedMediaLibrary = useMemo(() => {
  return [...mediaLibrary].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aTime = a.createdTime ? new Date(a.createdTime).getTime() : 0;
    const bTime = b.createdTime ? new Date(b.createdTime).getTime() : 0;
    return bTime - aTime;
  });
}, [mediaLibrary]);

async function toggleMediaPin(item: DriveMedia) {
  setMediaActionId(item.id);
  try {
    const response = await fetch("/api/media-library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pin", fileId: item.id, pinned: !item.pinned }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data?.error || "فشل تحديث حالة التثبيت");
    setMediaLibrary((current) =>
      current.map((mediaItem) =>
        mediaItem.id === item.id ? { ...mediaItem, pinned: data.pinned === true } : mediaItem
      )
    );
  } catch (error) {
    console.error("Media pin error:", error);
    alert(error instanceof Error ? error.message : "فشل تحديث حالة التثبيت");
  } finally {
    setMediaActionId(null);
  }
}

async function deleteLibraryMedia(item: DriveMedia) {
  setMediaActionId(item.id);
  try {
    const response = await fetch("/api/media-library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", fileId: item.id }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data?.error || "فشل حذف الملف");
    setMediaLibrary((current) => current.filter((mediaItem) => mediaItem.id !== item.id));
  } catch (error) {
    console.error("Media delete error:", error);
    alert(error instanceof Error ? error.message : "فشل حذف الملف");
  } finally {
    setMediaActionId(null);
  }
}

async function useLibraryMedia(item: DriveMedia) {
  try {
    const response = await fetch(item.url, {
      method: "HEAD",
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 404) {
        setMediaLibrary((current) =>
          current.filter((mediaItem) => mediaItem.id !== item.id)
        );
        alert("هذا الملف لم يعد متاحًا في Google Drive، لذلك تمت إزالته من مكتبة المحتوى.");
        return;
      }

      throw new Error("تعذر الوصول إلى الملف (" + response.status + ")");
    }

    setMedia(item.url);
    setMediaType(item.mediaType);
    setSection("Dashboard");

    if (item.mediaType !== "video" && platforms.includes("YouTube")) {
      setPlatforms(platforms.filter((platform) => platform !== "YouTube"));
    }
  } catch (error) {
    console.error("Media selection error:", error);
    alert(
      error instanceof Error
        ? error.message
        : "تعذر الوصول إلى ملف Google Drive."
    );
  }
}

function removePost(id: string) {
setPosts((current) =>
current.filter(
(post) => post.id !== id
)
);
}

return (
<div className="app">
<aside className="sidebar">
<div className="brand">
<strong>
دليلك البنكي
</strong>

      <span>
        Social Media Manager
      </span>
    </div>

    <nav>
      {[
        "Dashboard",
        "Content",
        "Calendar",
        "Accounts",
        "Analytics",
        "Settings",
      ].map((item) => (
        <button
          key={item}
          className={
            section === item
              ? "active"
              : ""
          }
          onClick={() =>
            setSection(item)
          }
        >
          {item}
        </button>
      ))}
    </nav>
  </aside>

  <main className="main">
    <header>
      <h1>
        لوحة تحكم السوشيال ميديا
      </h1>

      <p>
        إدارة ونشر محتوى دليلك البنكي
        من مكان واحد
      </p>
    </header>

    {section === "Dashboard" && (
      <section className="stats">
      <Stat
        label="Drafts"
        value={stats.drafts}
      />

      <Stat
        label="Scheduled"
        value={stats.scheduled}
      />

      <Stat
        label="Published"
        value={stats.published}
      />

      <Stat
        label="Failed"
        value={stats.failed}
      />
      </section>
    )}

    {section === "Dashboard" && (
      <section className="grid">
      <div className="card queue">
        <h2>
          محتوى قيد النشر
        </h2>

        <p className="muted">
          آخر المنشورات والمجدولة
        </p>

        <div className="posts">
          {posts
            .slice(0, 5)
            .map((post) => (
              <article
                className="post"
                key={post.id}
              >
                <div className="thumb">
                  {post.media ? (
                    post.mediaType ===
                    "video" ? (
                      <video
                        src={post.media}
                        muted
                        playsInline
                        preload="metadata"
                        style={{
                          width:
                            "100%",
                          height:
                            "100%",
                          objectFit:
                            "cover",
                        }}
                      />
                    ) : (
                      <img
                        src={post.media}
                        alt=""
                      />
                    )
                  ) : null}
                </div>

                <div>
                  <h3>
                    {post.title}
                  </h3>
                  <p>
                    {post.caption ||
                      "لا يوجد كابشن"}
                  </p>

                  <small>
                    {post.platforms.join(
                      " • "
                    )}{" "}
                    ·{" "}
                    {post.status}
                  </small>
                </div>
              </article>
            ))}

          {!posts.length && (
            <div className="empty">
              افتح أحد منشئات
              البوستات لإرسال الصورة
              والكابشن إلى الداشبورد.
            </div>
          )}
        </div>
      </div>

      <div className="card composer">
        <h2>
          إنشاء منشور
        </h2>

        <label>
          مصدر المحتوى
        </label>

        <div className="source-list">
          {(
            Object.keys(
              generators
            ) as Source[]
          ).map(
            (selectedSource) => (
              <button
                key={
                  selectedSource
                }
                onClick={() =>
                  openGenerator(
                    selectedSource
                  )
                }
              >
                {
                  generators[
                    selectedSource
                  ].label
                }
              </button>
            )
          )}
        </div>

        <label>
          Media
        </label>

        <div className="upload">
          {uploading ||
          uploadingMedia ? (
            <span>
              جاري رفع الملف...
            </span>
          ) : media ? (
            mediaType ===
            "video" ? (
              <video
                src={media}
                controls
                playsInline
                style={{
                  width:
                    "100%",
                  maxWidth:
                    "520px",
                  maxHeight:
                    "420px",
                  height:
                    "auto",
                  objectFit:
                    "contain",
                  display:
                    "block",
                  margin:
                    "0 auto",
                  borderRadius:
                    "12px",
                }}
              />
            ) : (
              <img
                src={media}
                alt="Poster"
                style={{
                  width:
                    "100%",
                  maxWidth:
                    "420px",
                  maxHeight:
                    "420px",
                  height:
                    "auto",
                  objectFit:
                    "contain",
                  display:
                    "block",
                  margin:
                    "0 auto",
                  borderRadius:
                    "12px",
                }}
              />
            )
          ) : (
            <span>
              سيظهر الملف هنا بعد رفعه
            </span>
          )}
        </div>

        <div className="external-upload">
          <label htmlFor="media-upload">
            {uploadingMedia
              ? "جاري الرفع..."
              : "Upload"}
          </label>

          <input
            id="media-upload"
            type="file"
            accept="image/*,video/*"
            onChange={
              handleMediaUpload
            }
            disabled={
              uploadingMedia ||
              uploading
            }
          />
        </div>

        <label>
          Caption
        </label>

        <textarea
          value={caption}
          onChange={(event) =>
            setCaption(
              event.target.value
            )
          }
          placeholder="اكتب الكابشن هنا..."
        />

        <label>
          Platforms
        </label>

        <div className="platforms">
          {loadingChannels ? (
            <span>
              جاري تحميل حسابات Buffer...
            </span>
          ) : availablePlatforms.length ===
            0 ? (
            <span>
              لا توجد حسابات Buffer متصلة
            </span>
          ) : (
            availablePlatforms.map(
              (platform) => (
                <button
                  key={
                    platform
                  }
                  className={
                    platforms.includes(
                      platform
                    )
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    togglePlatform(
                      platform
                    )
                  }
                >
                  {platform}                </button>
              )
            )
          )}
        </div>

        <button
          className="primary"
          disabled={
            uploading ||
            uploadingMedia ||
            !media
          }
          onClick={createPost}
        >
          إضافة إلى قائمة النشر
        </button>

        <button
          className="secondary"
          disabled={
            uploading ||
            uploadingMedia ||
            (!caption.trim() &&
              !media)
          }
          onClick={() => {
            if (
              !caption.trim() &&
              !media
            ) {
              return;
            }

            const channelIds =
              getChannelIdsForPlatforms(
                platforms
              );

            const draft: Post = {
              id: crypto.randomUUID(),
              source,
              title:
                titleFor(source),
              caption:
                caption.trim(),
              media,
              mediaType,
              platforms: [
                ...platforms,
              ],
              channelIds,
              status: "draft",
              createdAt:
                new Date().toISOString(),
            };

            setPosts(
              (current) => [
                draft,
                ...current,
              ]
            );

            setCaption("");
            setMedia("");
            setMediaType(
              "image"
            );
          }}
        >
          حفظ كمسودة
        </button>
      </div>
      </section>
    )}

    {section === "Dashboard" && posts.length > 0 && (
      <section className="card all">
        <h2>
          كل المحتوى
        </h2>

        {posts.map((post) => (
          <div
            className="row"
            key={post.id}
          >
            <div>
              <b>
                {post.title}
              </b>

              <span>
                {post.caption}
              </span>

              <small>
                {post.platforms.join(
                  " • "
                )}{" "}
                ·{" "}
                {post.status}
              </small>

              <small>
                النوع:{" "}
                {post.mediaType ===
                "video"
                  ? "فيديو"
                  : "صورة"}
              </small>

              {post.error && (
                <small>
                  خطأ:{" "}
                  {post.error}
                </small>
              )}
            </div>

            <div
              style={{
                display:
                  "flex",
                gap: "8px",
                alignItems:
                  "center",
              }}
            >
              {post.status !==
                "published" && (
                <button
                  disabled={
                    publishingId ===
                    post.id
                  }
                  onClick={() =>
                    publishPost(
                      post
                    )
                  }
                >
                  {publishingId ===
                  post.id
                    ? "جاري النشر..."
                    : "نشر الآن"}
                </button>
              )}

              <button
                onClick={() =>
                  removePost(
                    post.id
                  )
                }
              >
                حذف
              </button>
            </div>
          </div>
        ))}
      </section>
    )}

    {section === "Accounts" && (
      <section className="card buffer-accounts">
        <div className="buffer-accounts-header">
          <div>
            <h2>حسابات Buffer</h2>
            <p className="muted">
              حسابات Buffer المتصلة، الاستهلاك المتبقي للـ API، والقنوات المرتبطة بكل حساب
            </p>
          </div>
        </div>

        {loadingChannels ? (
          <div className="library-empty">جاري تحميل حسابات Buffer والقنوات...</div>
        ) : bufferAccounts.length === 0 ? (
          <div className="library-empty">لا توجد حسابات Buffer متصلة.</div>
        ) : (
          <div className="buffer-account-list">
            {bufferAccounts.map((account) => {
              const limits = account.rateLimits || {};
              const limitCards = [
                ["15 دقيقة", limits.fifteenMinutes],
                ["24 ساعة", limits.oneDay],
                ["30 يوم", limits.thirtyDays],
              ] as const;

              return (
                <article className="buffer-account-card" key={account.account}>
                  <div className="buffer-account-top">
                    <div className="buffer-account-identity">
                      {account.accountAvatar ? (
                        <img
                          src={account.accountAvatar}
                          alt=""
                          className="buffer-account-avatar"
                        />
                      ) : (
                        <div className="buffer-account-avatar fallback">
                          B{account.account}
                        </div>
                      )}
                      <div>
                        <span className="buffer-account-number">Buffer Account {account.account}</span>
                        <h3>{account.accountName || "حساب Buffer " + account.account}</h3>
                        {account.accountEmail && <p>{account.accountEmail}</p>}
                      </div>
                    </div>
                  </div>

                  <div className="buffer-rate-section">
                    <div className="buffer-section-title">
                      <strong>طلبات API المتبقية</strong>
                      <span>هذه حدود استخدام الـ API وليست رصيدًا منفصلًا للنشر</span>
                    </div>
                    <div className="buffer-rate-grid">
                      {limitCards.map(([label, limit]) => (
                        <div className="buffer-rate-card" key={label}>
                          <span>{label}</span>
                          <strong>
                            {limit ? limit.remaining.toLocaleString("ar-EG") : "—"}
                            {limit?.quota ? " / " + limit.quota.toLocaleString("ar-EG") : ""}
                          </strong>
                          <small>
                            {limit
                              ? "إعادة التعيين خلال " + formatBufferReset(limit.resetSeconds)
                              : "غير متاح"}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="buffer-channel-section">
                    <div className="buffer-section-title">
                      <strong>القنوات المتصلة بهذا الحساب</strong>
                      <span>{account.organizations.reduce((total, organization) => total + organization.channels.length, 0)} قناة</span>
                    </div>

                    {account.organizations.length === 0 ? (
                      <div className="buffer-no-channels">لا توجد مؤسسات أو قنوات متصلة.</div>
                    ) : (
                      <div className="buffer-organizations">
                        {account.organizations.map((organization) => (
                          <div className="buffer-organization" key={organization.id}>
                            <div className="buffer-organization-title">
                              <strong>{organization.name}</strong>
                              {organization.ownerEmail && <small>{organization.ownerEmail}</small>}
                            </div>

                            {organization.channels.length === 0 ? (
                              <span className="buffer-no-channels">لا توجد قنوات في هذه المؤسسة.</span>
                            ) : (
                              <div className="buffer-channel-list">
                                {organization.channels.map((channel) => (
                                  <div className="buffer-channel-item" key={channel.id}>
                                    {channel.avatar ? (
                                      <img src={channel.avatar} alt="" />
                                    ) : (
                                      <div className="buffer-channel-avatar-fallback">
                                        {(channel.displayName || channel.name || channel.service).slice(0, 1).toUpperCase()}
                                      </div>
                                    )}
                                    <div className="buffer-channel-info">
                                      <strong>{channel.displayName || channel.name}</strong>
                                      <span>{channel.service}</span>
                                    </div>
                                    <span className={
                                      "buffer-channel-status" +
                                      (channel.isDisconnected || channel.isLocked ? " problem" : "")
                                    }>
                                      {channel.isDisconnected
                                        ? "غير متصل"
                                        : channel.isLocked
                                        ? "مقفل"
                                        : channel.isQueuePaused
                                        ? "متوقف مؤقتًا"
                                        : "متصل"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    )}

    {section === "Content" && (
      <section className="card media-library">
        <div className="media-library-header">
          <div>
            <h2>مكتبة المحتوى</h2>
            <p className="muted">كل الصور والفيديوهات الموجودة في Google Drive</p>
          </div>

          <div className="media-library-tools">
            <span className="media-view-label">حجم العرض</span>
            <div className="media-view-switcher" aria-label="حجم العرض">
              <button type="button" className={mediaView === "small" ? "active" : ""} onClick={() => setMediaView("small")} aria-pressed={mediaView === "small"}>صغير</button>
              <button type="button" className={mediaView === "medium" ? "active" : ""} onClick={() => setMediaView("medium")} aria-pressed={mediaView === "medium"}>متوسط</button>
              <button type="button" className={mediaView === "large" ? "active" : ""} onClick={() => setMediaView("large")} aria-pressed={mediaView === "large"}>كبير</button>
            </div>
            <button
              className="library-refresh"
              onClick={() => setMediaLibraryRefresh((value) => value + 1)}
              disabled={loadingMediaLibrary}
            >
              {loadingMediaLibrary ? "جاري التحديث..." : "تحديث"}
            </button>
          </div>
        </div>

        {loadingMediaLibrary ? (
          <div className="library-empty">جاري تحميل الملفات من Google Drive...</div>
        ) : mediaLibrary.length === 0 ? (
          <div className="library-empty">لا توجد صور أو فيديوهات في Google Drive.</div>
        ) : (
          <div className={"media-library-grid view-" + mediaView}>
            {sortedMediaLibrary.map((item) => (
              <article className={"media-card" + (item.pinned ? " is-pinned" : "")} key={item.id}>
                <div className="media-card-preview">
                  {item.mediaType === "video" ? (
                    <video
                      src={item.url}
                      muted
                      playsInline
                      preload="metadata"
                      onError={(event) => {
                        const mediaElement = event.currentTarget;
                        if (mediaElement.dataset.invalidHandled === "true") return;
                        mediaElement.dataset.invalidHandled = "true";
                        setMediaLibrary((current) =>
                          current.filter((mediaItem) => mediaItem.id !== item.id)
                        );
                      }}
                    />
                  ) : (
                    <img
                      src={item.url}
                      alt={item.name}
                      loading="lazy"
                      onError={(event) => {
                        const mediaElement = event.currentTarget;
                        if (mediaElement.dataset.invalidHandled === "true") return;
                        mediaElement.dataset.invalidHandled = "true";
                        setMediaLibrary((current) =>
                          current.filter((mediaItem) => mediaItem.id !== item.id)
                        );
                      }}
                    />
                  )}
                  {item.pinned && <span className="media-pin-badge" aria-label="مثبت">📌</span>}
                </div>
                <div className="media-card-body">
                  <strong title={item.name}>{item.name}</strong>
                  <small>
                    {item.createdTime ? new Date(item.createdTime).toLocaleDateString("ar-EG") : ""}
                    {item.size ? " · " + formatMediaSize(item.size) : ""}
                  </small>
                  <div className="media-card-actions">
                    <button className="use-media-button" onClick={() => useLibraryMedia(item)}>استخدام</button>
                    <button
                      className={"pin-media-button" + (item.pinned ? " pinned" : "")}
                      onClick={() => toggleMediaPin(item)}
                      disabled={mediaActionId === item.id}
                    >
                      {item.pinned ? "إلغاء التثبيت" : "تثبيت"}
                    </button>
                    <button
                      className="delete-media-button"
                      onClick={() => deleteLibraryMedia(item)}
                      disabled={mediaActionId === item.id}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    )}

  </main>
</div>

);
}

function formatBufferReset(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return Math.ceil(seconds) + " ث";
  if (seconds < 3600) return Math.floor(seconds / 60) + " د";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " س";
  return Math.floor(seconds / 86400) + " يوم";
}

function formatMediaSize(size?: string | null) {
  if (!size) return "";
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

function Stat({
label,
value,
}: {
label: string;
value: number;
}) {
return (
<div className="stat">
<span>{label}</span>

  <strong>{value}</strong>
</div>

);
}