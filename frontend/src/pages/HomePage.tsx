import { Link } from "react-router-dom";
import Header from "../components/Header";

type Featured = {
  title: string;
  price: string;
  location: string;
  imageUrl: string;
  tag: string;
};

const FEATURED: Featured[] = [
  {
    title: "Blue Dream Shrimp colony",
    price: "$35",
    location: "Brisbane",
    tag: "Featured",
    imageUrl:
      "https://images.unsplash.com/photo-1544551763-cede1e8b4f39?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Planted nano tank starter kit",
    price: "$120",
    location: "Gold Coast",
    tag: "Popular",
    imageUrl:
      "https://images.unsplash.com/photo-1520301255226-bf5f144451e1?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Fancy guppies (pair)",
    price: "$25",
    location: "Sydney",
    tag: "New",
    imageUrl:
      "https://images.unsplash.com/photo-1535591273668-578e31182c4f?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Anubias + Java fern bundle",
    price: "$18",
    location: "Melbourne",
    tag: "Great value",
    imageUrl:
      "https://images.unsplash.com/photo-1520004434532-668416a08753?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "External canister filter (quiet)",
    price: "$90",
    location: "Perth",
    tag: "Verified",
    imageUrl:
      "https://images.unsplash.com/photo-1528826194825-89fbb4f4b258?auto=format&fit=crop&w=1400&q=80",
  },
  {
    title: "Betta splendens (male)",
    price: "$40",
    location: "Adelaide",
    tag: "Featured",
    imageUrl:
      "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=1400&q=80",
  },
];

function FeaturedCard({ item }: { item: Featured }) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur hover:bg-white/10">
      <div className="relative aspect-[4/3] w-full bg-black/20">
        <img
          src={item.imageUrl}
          alt=""
          className="h-full w-full object-cover opacity-85 transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
          {item.tag}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-white">{item.title}</div>
            <div className="mt-1 truncate text-xs font-semibold text-white/75">{item.location}</div>
          </div>
          <div className="shrink-0 rounded-xl bg-white px-3 py-1 text-xs font-extrabold text-slate-900">{item.price}</div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const hero =
    "https://images.unsplash.com/photo-1520301255226-bf5f144451e1?auto=format&fit=crop&w=2000&q=80";

  return (
    <div className="min-h-full">
      <Header maxWidth="6xl" />

      <div className="relative">
        <div className="absolute inset-0 -z-10">
          <img src={hero} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/65 to-slate-950" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.10),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(56,189,248,0.10),transparent_35%),radial-gradient(circle_at_20%_90%,rgba(16,185,129,0.10),transparent_40%)]" />
        </div>

        <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Buy & sell fish, plants, shrimp, equipment
            </div>

            <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
              Find great local aquarium deals.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-white/80">
              Browse listings from hobbyists near you, or post your own in minutes. Simple, fast, and made for freshwater setups.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/browse"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-100"
              >
                Browse listings
              </Link>
              <Link
                to="/post"
                className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-extrabold text-white hover:bg-white/10"
              >
                Post a listing
              </Link>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <div className="text-sm font-extrabold text-white">Local pickup</div>
                <div className="mt-1 text-xs font-semibold text-white/70">Filter by location</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <div className="text-sm font-extrabold text-white">Fast posting</div>
                <div className="mt-1 text-xs font-semibold text-white/70">Photos + details</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <div className="text-sm font-extrabold text-white">Account tools</div>
                <div className="mt-1 text-xs font-semibold text-white/70">Profile + my listings</div>
              </div>
            </div>
          </div>

          <section className="mt-12">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/60">Featured</div>
                <h2 className="mt-2 text-2xl font-black text-white">Today’s picks</h2>
                <div className="mt-1 text-sm font-semibold text-white/70">
                  Placeholder cards for now — we can hook this to real listings later.
                </div>
              </div>
              <Link to="/browse" className="text-sm font-extrabold text-white/80 hover:text-white">
                View all →
              </Link>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURED.map((x) => (
                <Link key={x.title} to="/browse" className="block">
                  <FeaturedCard item={x} />
                </Link>
              ))}
            </div>
          </section>

          <section className="mt-12 overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xl font-black text-white">Ready to list something?</div>
                <div className="mt-1 text-sm font-semibold text-white/70">Post fish, plants, shrimp, snails, or equipment.</div>
              </div>
              <div className="flex gap-3">
                <Link
                  to="/post"
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-extrabold text-slate-950 hover:bg-emerald-300"
                >
                  Create listing
                </Link>
                <Link
                  to="/browse"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-extrabold text-white hover:bg-white/10"
                >
                  Browse
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

