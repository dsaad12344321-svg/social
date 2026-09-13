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

  /*
   * LOAD POSTS
   */
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

            platforms: [
              "Facebook",
              "Instagram",
            ],

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

            platforms: [
              "Facebook",
              "Instagram",
            ],

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

        platforms: [
          "Facebook",
          "Instagram",
        ],

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
  }, []);

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
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter(
            (item) => item !== platform
          )
        : [...current, platform]
    );
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

      status,

      createdAt:
        new Date().toISOString(),
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
  async function publishPost(
    post: Post
  ) {
    if (publishingId) {
      return;
    }

    if (!post.platforms.length) {
      alert(
        "اختر منصة واحدة على الأقل"
      );
      return;
    }

    if (!post.image) {
      alert(
        "لا توجد صورة لهذا المنشور"
      );
      return;
    }

    const supportedPlatforms =
      post.platforms.filter(
        (platform) =>
          platform === "Facebook" ||
          platform === "Instagram"
      );

    if (
      !supportedPlatforms.length
    ) {
      alert(
        "النشر متاح حاليًا على Facebook و Instagram فقط."
      );
      return;
    }

    setPublishingId(post.id);

    /*
     * Mark as scheduled while publishing.
     */
    setPosts((current) =>
      current.map((item) =>
        item.id === post.id
          ? {
              ...item,
              status: "scheduled",
              error: undefined,
            }
          : item
      )
    );

    try {
      const results: {
        platform: Platform;
        success: boolean;
        data: unknown;
      }[] = [];

      for (const platform of supportedPlatforms) {
        const response =
          await fetch(
            "/api/meta/publish",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                platform,
                imageUrl: post.image,
                caption:
                  post.caption,
              }),
            }
          );

        const data =
          await response.json();

        results.push({
          platform,
          success:
            response.ok &&
            data.success === true,
          data,
        });
      }

      const failed =
        results.filter(
          (result) =>
            !result.success
        );

      if (!failed.length) {
        setPosts((current) =>
          current.map((item) =>
            item.id === post.id
              ? {
                  ...item,
                  status:
                    "published",
                }
              : item
          )
        );

        alert(
          "تم نشر المنشور بنجاح على جميع المنصات المحددة."
        );

        return;
      }

      const failedPlatforms =
        failed
          .map(
            (result) =>
              result.platform
          )
          .join(", ");

      const errorMessage =
        failed
          .map((result) => {
            const data =
              result.data as {
                error?: unknown;
              };

            return `${result.platform}: ${
              typeof data?.error ===
              "string"
                ? data.error
                : JSON.stringify(
                    data?.error ||
                      result.data
                  )
            }`;
          })
          .join("\n");

      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                status: "failed",
                error: errorMessage,
              }
            : item
        )
      );

      alert(
        `فشل النشر على: ${failedPlatforms}\n\n${errorMessage}`
      );
    } catch (error) {
      console.error(
        "Publish error:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "حدث خطأ أثناء النشر";

      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? {
                ...item,
                status: "failed",
                error: message,
              }
            : item
        )
      );

      alert(message);
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
              ) : (
                <span>
                  سيظهر البوستر هنا بعد
                  إرساله من المنشئ
                </span>
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
                  title:
                    titleFor(source),
                  caption,
                  image,
                  platforms,
                  status: "draft",
                  createdAt:
                    new Date().toISOString(),
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