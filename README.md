# MIRPURIAN

No admin panel. Every post is two files you upload to your Vercel Blob store:
the main file and a small .json file that describes it.

## Files in this folder
server.js (the Node/Express app), blobindex.js (reads the Blob store), index.html + home.js (home),
post.html + post.js (post page), ads.js (ad banner), style.css, package.json, .env.example.

## Deploy (free plan)
1. Push this folder to GitHub and import it in Vercel. Name the project mirpurian.
2. Project > Storage: create a Blob store with PUBLIC access and connect it to the project.
   (This adds BLOB_READ_WRITE_TOKEN for you.)
3. Optional, for comments / reactions / view counts: Storage > Marketplace > Upstash Redis (free), connect it.
4. Redeploy. Open /api/health to check that everything is connected.

## Adding a post
Upload these two files to the Blob store (same folder, same name, different extension):

    physics-ch1.pdf      the main file
    physics-ch1.json     the description

physics-ch1.json:

    {
      "title": "Physics Chapter 1 Notes",
      "section": "notes",
      "subject": "Physics",
      "description": "Handwritten notes covering motion and vectors.",
      "file": "physics-ch1.pdf",
      "thumb": "physics-ch1.thumb.jpg",
      "date": "2026-10-09",
      "pinned": false,
      "tags": ["hsc", "physics"]
    }

Everything is optional except that a post needs a .json file.
- section: any name. syllabus, notes, notice, suggestions, others are built in. A new name creates a new section.
- file: a file in the store (path relative to the .json file) or a full https:// link. If you leave it out,
  the file with the same name as the .json is used. A post with no file is a text-only post (good for notices).
- thumb: a small image (about 400 px wide, jpg/webp) for fast loading. If you leave it out, a file named
  physics-ch1.thumb.jpg next to it is used. Image posts use the image itself.
- date: YYYY-MM-DD. Defaults to the upload date. pinned: true keeps it on top. hidden: true hides it.
- File names in the JSON must match the names shown in the Blob store exactly.

## Ads (32:9 banners)
Upload images or GIFs into a folder called ads/ (for example ads/one.png), or name them ad-one.png.
A random one is shown on every page load. 1920x540 is a good size. Keep GIFs small.

## Optional site.json (at the root of the store)
    { "title": "MIRPURIAN",
      "sections": [ { "id": "notes", "name": "Notes", "icon": "📝" } ] }
Use it to choose the order, names and icons of the sections.

## Free plan limits
- The post list is cached (CACHE_MINUTES, default 30), so a new post can take up to about 30 minutes to appear.
  Set CACHE_MINUTES to 5 while you are adding many posts, then put it back.
- Listing files, uploading, and even browsing or uploading in the Vercel dashboard count as Blob "advanced
  operations". The free plan has 2,000 per month. If you go over, Blob stops working.
- Keep thumbnails small, and compress ads.

## Moderation
Comments live in Upstash. To delete one, open your Upstash database > Data Browser > the hash comments:<post id>
and delete the field.
