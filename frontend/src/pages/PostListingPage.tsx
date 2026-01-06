// frontend/src/pages/PostListingPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createListing,
  uploadImage,
  resolveImageUrl,
  setOwnerToken,
  type Category,
  type ImageAsset,
} from "../api";
import Header from "../components/Header";

function dollarsToCents(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const CATEGORIES: Category[] = ["Fish", "Shrimp", "Snails", "Plants", "Equipment"];

type PendingImage = {
  id: string;
  file: File;
  uploaded?: ImageAsset;
  status: "ready" | "uploading" | "uploaded" | "error";
  error?: string;
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function PostListingPage() {
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Fish");
  const [species, setSpecies] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");

  const [imgs, setImgs] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function removeImg(id: string) {
    setImgs((prev) => prev.filter((x) => x.id !== id));
  }

  function moveImg(id: string, dir: -1 | 1) {
    setImgs((prev) => {
      const i = prev.findIndex((x) => x.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
      return copy;
    });
  }

  function onPickFiles(nextFiles: FileList | null) {
    setErr(null);
    if (!nextFiles) return;

    setImgs((prev) => {
      const room = Math.max(0, 6 - prev.length);
      const picked = Array.from(nextFiles).slice(0, room);
      if (!picked.length) return prev;

      return [
        ...prev,
        ...picked.map((f) => ({
          id: uid(),
          file: f,
          status: "ready" as const,
        })),
      ];
    });
  }

  const previews = useMemo(() => {
    return imgs.map((img) => {
      const resolvedThumb = img.uploaded?.thumbUrl ? resolveImageUrl(img.uploaded.thumbUrl) : null;
      const resolvedFull = img.uploaded?.fullUrl ? resolveImageUrl(img.uploaded.fullUrl) : null;

      return {
        id: img.id,
        status: img.status,
        error: img.error,
        src: resolvedThumb || resolvedFull || URL.createObjectURL(img.file),
        uploaded: !!img.uploaded,
        local: !img.uploaded,
      };
    });
  }, [imgs]);

  useEffect(() => {
    const locals = previews.filter((p) => p.local).map((p) => p.src);
    return () => {
      for (const u of locals) URL.revokeObjectURL(u);
    };
  }, [previews]);

  async function uploadOne(img: PendingImage) {
    setImgs((prev) => prev.map((x) => (x.id === img.id ? { ...x, status: "uploading", error: undefined } : x)));

    try {
      const asset = await uploadImage(img.file);
      setImgs((prev) => prev.map((x) => (x.id === img.id ? { ...x, status: "uploaded", uploaded: asset } : x)));
      return asset;
    } catch (e: any) {
      const msg = e?.message ?? "Upload failed";
      setImgs((prev) => prev.map((x) => (x.id === img.id ? { ...x, status: "error", error: msg } : x)));
      throw new Error(msg);
    }
  }

  async function doUploadAll() {
    if (!imgs.length) return;

    setErr(null);
    setUploading(true);
    try {
      for (const img of imgs) {
        if (img.status === "uploaded" && img.uploaded) continue;
        await uploadOne(img).catch(() => {});
      }
    } finally {
      setUploading(false);
    }
  }

  async function retryUpload(id: string) {
    const img = imgs.find((x) => x.id === id);
    if (!img) return;
    setErr(null);
    setUploading(true);
    try {
      await uploadOne(img);
    } catch {
      // per-image error already stored
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = !loading && !uploading && !imgs.some((i) => i.status === "uploading");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const priceCents = dollarsToCents(priceDollars);
    if (priceCents === null) {
      setErr("Please enter a valid non-negative price.");
      return;
    }

    setLoading(true);
    try {
      if (imgs.some((i) => i.status !== "uploaded")) {
        await doUploadAll();
      }

      const uploadedAssets = imgs
        .filter((i) => i.status === "uploaded" && i.uploaded)
        .map((i) => i.uploaded!)
        .slice(0, 6);

      if (imgs.length > 0 && uploadedAssets.length === 0) {
        throw new Error("Images were selected but none uploaded successfully. Remove broken images or retry upload.");
      }

      const created = await createListing({
        title: title.trim(),
        category,
        species: species.trim(),
        priceCents,
        location: location.trim(),
        description: description.trim(),
        contact: contact.trim() ? contact.trim() : null,
        images: uploadedAssets,
      });

      setOwnerToken(created.id, created.ownerToken);
      nav(`/listing/${created.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to post listing");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full">
      <Header maxWidth="3xl" />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Post a listing</h1>
        <div className="mt-1 text-sm text-slate-600">Add up to 6 photos.</div>

        {err && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{err}</div>}

        <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          {/* Images */}
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">Photos</div>
                <div className="text-xs text-slate-600">JPG / PNG / WebP up to 6MB each</div>
              </div>

              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                  Choose
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => onPickFiles(e.target.files)}
                  />
                </label>

                <button
                  type="button"
                  onClick={doUploadAll}
                  disabled={!imgs.length || uploading}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {uploading ? "Uploading…" : imgs.length && imgs.every((i) => i.status === "uploaded") ? "Uploaded" : "Upload"}
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {previews.length ? (
                previews.map((p, idx) => (
                  <div key={p.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="relative h-28 w-full bg-slate-100">
                      <img src={p.src} alt={`preview-${idx}`} className="h-full w-full object-cover" loading="lazy" decoding="async" />

                      <div className="absolute left-2 top-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveImg(p.id, -1)}
                          disabled={idx === 0}
                          className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
                          title="Move left"
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImg(p.id, 1)}
                          disabled={idx === previews.length - 1}
                          className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-50"
                          title="Move right"
                        >
                          →
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeImg(p.id)}
                        className="absolute right-2 top-2 rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-white"
                        title="Remove"
                      >
                        ✖
                      </button>

                      <div className="absolute bottom-2 left-2 flex items-center gap-2">
                        <div className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-700">
                          {p.status === "uploading"
                            ? "Uploading…"
                            : p.status === "uploaded"
                            ? "Uploaded"
                            : p.status === "error"
                            ? "Error"
                            : "Ready"}
                        </div>

                        {p.status === "error" && (
                          <button
                            type="button"
                            onClick={() => retryUpload(p.id)}
                            disabled={uploading}
                            className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-900 hover:bg-white disabled:opacity-60"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>

                    {p.status === "error" && p.error && (
                      <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        {p.error}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="col-span-full flex h-28 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500">
                  No images selected
                </div>
              )}
            </div>

            <div className="mt-3 text-xs text-slate-600">Tip: the first photo becomes the thumbnail on the homepage.</div>
          </div>

          {/* Fields */}
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Title</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              required
              minLength={3}
              maxLength={80}
              placeholder="e.g. Guppy trio - healthy stock"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Species</div>
              <input
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                minLength={2}
                maxLength={60}
                placeholder="e.g. Betta splendens"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Price ($)</div>
              <input
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                placeholder="e.g. 25"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold text-slate-700">Location</div>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. Brisbane"
              />
            </label>
          </div>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Contact (optional)</div>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="e.g. phone, email, or 'DM here'"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              maxLength={200}
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs font-semibold text-slate-700">Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[140px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              required
              minLength={1}
              maxLength={1000}
              placeholder="Add details like age/size, water params, pickup, etc."
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? "Posting..." : uploading ? "Uploading..." : "Post listing"}
            </button>

            <Link
              to="/"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
