"use client";

import { useEffect, useMemo, useState } from "react";

type Source =
  | "certificates"
  | "deposits"
  | "treasury";

type Platform =
  | "Facebook"
  | "Instagram"
  | "TikTok"
  | "X";

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
  channels: BufferChannel[];
  errors?: Array<{
    account: number;
    error: string;
  }>;
};

type Status =
  | "draft"
  | "scheduled"
  | "published"
  | "failed";

type Post = {
  id: string;
  source: Source;
  title: string;
  caption: string;
  image: string;
  platforms: Platform[];
  channelIds: string[];
  status: Status;
  createdAt: string;
  error?: string;
};

const STORAGE =
  "daleelak-social-posts-v2";

const BANKS_URL =
  "https://daleelakelbanky.vercel.app";

const generators: Record<
  Source,
  {
    label: string;
    path: string;
  }
> = {
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

export default function Dashboard() {
  const [posts, setPosts] =
    useState<Post[]>([]);

  const [caption, setCaption] =
    useState("");

  const [image, setImage] =
    useState("");

  const [source, setSource] =
    useState<Source>("certificates");
  
  const [externalImage, setExternalImage] = useState("");
  const [uploadingExternalImage, setUploadingExternalImage] =
    useState(false);

  const [platforms, setPlatforms] =
    useState<Platform[]>([
      "Facebook",
      "Instagram",
    ]);

  const [section, setSection] =
    useState("Dashboard");

  const [uploading, setUploading] =
    useState(false);

  const [publishingId, setPublishingId] =
    useState<string | null>(null);

  const [bufferChannels, setBufferChannels] =
    useState<BufferChannel[]>([]);

  const [selectedChannelIds, setSelectedChannelIds] =
    useState<string[]>([]);

  const [loadingChannels, setLoadingChannels] =
    useState(false);
  
  async function handleExternalImageUpload(
  event: React.ChangeEvent<HTMLInputElement>
) {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("من فضلك اختر صورة فقط");
    return;
  }

  setUploadingExternalImage(true);

  try {
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const dataUrl = reader.result;

        if (
          typeof dataUrl !== "string" ||
          !dataUrl.startsWith("data:image/")
        ) {
          throw new Error("Invalid image");
        }

        const response = await fetch(
          "/api/upload",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              image: dataUrl,
            }),
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data?.error ||
              "فشل رفع الصورة"
          );
        }

        setExternalImage(data.url);

        alert("تم رفع الصورة بنجاح");
        
        console.log(
          "External image URL:",
          data.url
        );
      } catch (error) {
        console.error(
          "External upload error:",
          error
        );

        alert(
          error instanceof Error
            ? error.message
            : "فشل رفع الصورة"
        );
      } finally {
        setUploadingExternalImage(false);
      }
    };

    reader.onerror = () => {
      setUploadingExternalImage(false);
      alert("فشل قراءة الصورة");
    };

    reader.readAsDataURL(file);
  } catch (error) {
    console.error(error);
    setUploadingExternalImage(false);
  }
}
  
  /*
   * LOAD POSTS AND CHANNELS
   */
  
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

        setBufferChannels(
          Array.isArray(data.channels)
            ? data.channels
            : []
        );

        /*
        * Initially select all connected channels.
        */
        setSelectedChannelIds(
          (data.channels || [])
            .filter(
              (channel) =>
                !channel.isDisconnected &&
                !channel.isLocked
            )
            .map((channel) => channel.id)
        );
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
      const raw =
        localStorage.getItem(STORAGE);

      if (raw) {
        setPosts(JSON.parse(raw));
      }
    } catch (error) {
      console.error(
        "Failed to load posts:",
        error
      );
    }
  }, []);

  /*
   * SAVE POSTS
   *
   * Images are now public HTTPS URLs,
   * not Base64.
   */
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

  /*
   * RECEIVE POST FROM BANK GENERATOR
   */
  useEffect(() => {
    const onMessage = async (
      event: MessageEvent
    ) => {
      const data = event.data;

      if (
        !data ||
        data.type !==
          "DALEELAK_SOCIAL_POST"
      ) {
        return;
      }

      const incomingSource: Source =
        data.source === "treasury" ||
        data.source === "deposits"
          ? data.source
          : "certificates";

      const incomingCaption =
        data.caption || "";

      const incomingImage =
        data.image || "";

      setSource(incomingSource);
      setCaption(incomingCaption);
      setImage(incomingImage);
      setSection("Content");

      /*
       * If there is an image,
       * upload it immediately.
       */
      if (incomingImage) {
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
                image: incomingImage,
              }),
            });

          const uploadData =
            await uploadResponse.json();

          if (
            !uploadResponse.ok ||
            !uploadData.url
          ) {
            throw new Error(
              uploadData.error ||
                "فشل رفع الصورة"
            );
          }

          const post: Post = {
            id: crypto.randomUUID(),

            source: incomingSource,

            title:
              data.title ||
              titleFor(incomingSource),

            caption: incomingCaption,

            image: uploadData.url,

            platforms: platforms,

            channelIds: selectedChannelIds,

            status: "draft",

            createdAt:
              new Date().toISOString(),
          };

          setPosts((current) => [
            post,
            ...current,
          ]);

          /*
           * Show public URL in composer
           */
          setImage(uploadData.url);
        } catch (error) {
          console.error(
            "Image upload failed:",
            error
          );

          const post: Post = {
            id: crypto.randomUUID(),

            source: incomingSource,

            title:
              data.title ||
              titleFor(incomingSource),

            caption: incomingCaption,

            image: "",

            platforms: platforms,

            channelIds: selectedChannelIds,

            status: "failed",

            createdAt:
              new Date().toISOString(),

            error:
              error instanceof Error
                ? error.message
                : "فشل رفع الصورة",
          };

          setPosts((current) => [
            post,
            ...current,
          ]);

          alert(
            error instanceof Error
              ? error.message
              : "فشل رفع الصورة"
          );
        } finally {
          setUploading(false);
        }

        return;
      }

      /*
       * If there is no image,
       * create normal draft.
       */
      const post: Post = {
        id: crypto.randomUUID(),

        source: incomingSource,

        title:
          data.title ||
          titleFor(incomingSource),

        caption: incomingCaption,

        image: "",

        platforms: platforms,

        channelIds: selectedChannelIds,

        status: "draft",

        createdAt:
          new Date().toISOString(),
      };

      setPosts((current) => [
        post,
        ...current,
      ]);
    };

    window.addEventListener(
      "message",
      onMessage
    );

    return () =>
      window.removeEventListener(
        "message",
        onMessage
      );
  }, [selectedChannelIds, platforms]);

  /*
   * STATS
   */
  const stats = useMemo(
    () => ({
      drafts: posts.filter(
        (p) => p.status === "draft"
      ).length,

      scheduled: posts.filter(
        (p) => p.status === "scheduled"
      ).length,

      published: posts.filter(
        (p) => p.status === "published"
      ).length,

      failed: posts.filter(
        (p) => p.status === "failed"
      ).length,
    }),
    [posts]
  );

  /*
   * OPEN GENERATOR
   */
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

  /*
   * PLATFORM TOGGLE
   */
function togglePlatform(
  platform: Platform
) {
  const willSelect =
    !platforms.includes(platform);

  setPlatforms((current) =>
    willSelect
      ? [...current, platform]
      : current.filter(
          (item) => item !== platform
        )
  );

  const matchingChannels =
    bufferChannels.filter(
      (channel) =>
        channel.service.toLowerCase() ===
          platform.toLowerCase() &&
        !channel.isDisconnected &&
        !channel.isLocked
    );

  setSelectedChannelIds((current) => {
    if (willSelect) {
      const newIds =
        matchingChannels
          .map((channel) => channel.id)
          .filter(
            (id) => !current.includes(id)
          );

      return [...current, ...newIds];
    }

    const removeIds =
      new Set(
        matchingChannels.map(
          (channel) => channel.id
        )
      );

    return current.filter(
      (id) => !removeIds.has(id)
    );
  });
}

  /*
   * SAVE MANUAL POST
   */
  function save(status: Status) {
    if (
      !caption.trim() &&
      !image
    ) {
      return;
    }

    const post: Post = {
      id: crypto.randomUUID(),
      source,
      title: titleFor(source),
      caption,
      image,
      platforms,
      channelIds: selectedChannelIds,
      status,
      createdAt: new Date().toISOString(),
    };

    setPosts((current) => [
      post,
      ...current,
    ]);

    setCaption("");
    setImage("");
  }

  /*
   * UPLOAD BASE64 IMAGE
   */
  async function uploadImage(
    base64Image: string
  ) {
    const response =
      await fetch("/api/upload", {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          image: base64Image,
        }),
      });

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.url
    ) {
      throw new Error(
        data.error ||
          "فشل رفع الصورة"
      );
    }

    return data.url as string;
  }

  /*
   * PUBLISH POST
   */

async function publishPost(post: Post) {
  if (!post.image) {
    alert("لا توجد صورة لهذا المنشور");
    return;
  }

  if (!post.caption.trim()) {
    alert("لا يوجد Caption لهذا المنشور");
    return;
  }

  if (!post.channelIds || post.channelIds.length === 0) {
    alert("اختر حسابًا واحدًا على الأقل من Buffer");
    return;
  }

  setPublishingId(post.id);

  try {
    const response = await fetch(
      "/api/buffer/publish",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: post.image,
          caption: post.caption,
          channelIds: post.channelIds,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success && !data.partialSuccess) {
      throw new Error(
        data?.error ||
          "فشل نشر المنشور عبر Buffer"
      );
    }

    setPosts((prev) =>
      prev.map((item) =>
        item.id === post.id
          ? {
              ...item,
              status:
                data.partialSuccess
                  ? "failed"
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

    setPosts((prev) =>
      prev.map((item) =>
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

  /*
   * DELETE
   */
  function remove(id: string) {
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

        <section className="stats">
          <Stat
            label="Drafts"
            value={stats.drafts}
          />

          <Stat
            label="Scheduled"
            value={
              stats.scheduled
            }
          />

          <Stat
            label="Published"
            value={
              stats.published
            }
          />

          <Stat
            label="Failed"
            value={stats.failed}
          />
        </section>

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
                      {post.image && (
                        <img
                          src={
                            post.image
                          }
                          alt=""
                        />
                      )}
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
                (
                  selectedSource
                ) => (
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
              Poster
            </label>

            <div className="upload">
              {uploading ? (
                <span>
                  جاري رفع الصورة...
                </span>
              ) : image ? (
                <img
                  src={image}
                  alt="Poster"
                />
              ) : externalImage ? (
                <img
                  src={externalImage}
                  alt="Uploaded"
                />
              ) : (
                <span>
                  سيظهر البوستر هنا بعد
                  إرساله من المنشئ
                </span>
              )}
            </div>

            <div className="external-upload">
              <label
                htmlFor="external-image-upload"
              >
                {uploadingExternalImage
                  ? "جاري رفع الصورة..."
                  : "Upload Image"}
              </label>

              <input
                id="external-image-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={
                  handleExternalImageUpload
                }
                disabled={
                  uploadingExternalImage
                }
              />

              {externalImage && (
                <div>
                  <p>
                    تم رفع الصورة بنجاح
                  </p>

                  <img
                    src={externalImage}
                    alt="Uploaded preview"
                  />

                  <small>
                    {externalImage}
                  </small>
                </div>
              )}
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
              {(
                [
                  "Facebook",
                  "Instagram",
                  "TikTok",
                  "X",
                ] as Platform[]
              ).map((platform) => (
                <button
                  key={platform}
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
                  {platform}
                </button>
              ))}
            </div>

            <button
              className="primary"
              disabled={
                uploading ||
                !image
              }
            onClick={() => {
              const draft: Post = {
                id: crypto.randomUUID(),
                source,
                title: titleFor(source),
                caption,
                image,
                platforms,
                channelIds: selectedChannelIds,
                status: "draft",
                createdAt: new Date().toISOString(),
              };

                setPosts((current) => [
                  draft,
                  ...current,
                ]);

                setCaption("");
                setImage("");
              }}
            >
              إضافة إلى قائمة النشر
            </button>

            <button
              className="secondary"
              disabled={
                uploading ||
                (!caption.trim() &&
                  !image)
              }
              onClick={() =>
                save("draft")
              }
            >
              حفظ كمسودة
            </button>
          </div>
        </section>

        {!!posts.length && (
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

                  {post.error && (
                    <small>
                      خطأ:{" "}
                      {post.error}
                    </small>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
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
                      remove(post.id)
                    }
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
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
      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>
    </div>
  );
}