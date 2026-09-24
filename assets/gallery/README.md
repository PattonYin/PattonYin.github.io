# Gallery media

Put compressed photos and MP4 clips in this folder, then list them under `"gallery"` in
`data/content.json`:

```json
{
  "src": "assets/gallery/your-photo.jpg",
  "title": "A short project title",
  "caption": "What's happening in the shot.",
  "alt": "Short description for screen readers",
  "tags": ["iiwa", "bimanual"]
}
```

- `caption` shows under the thumbnail and in the lightbox. `alt` and `tags` are
  optional (`alt` falls back to `caption`).
- Thumbnails are cropped to 16:10 with `object-fit: cover`, so keep the subject
  near the centre. The lightbox shows the full uncropped image.
- For an MP4, add a JPEG poster with the same basename (e.g. `demo.mp4` and
  `demo.jpg`), or set `poster` explicitly. Only the poster loads until clicked.
- Keep clips under 5 MB where possible. Store raw recordings outside Git.
- Resize before committing; ~1600px on the long edge is plenty. Example:
  `python -c "from PIL import Image; im=Image.open('in.jpg'); im.thumbnail((1600,1600)); im.save('out.jpg',quality=88,optimize=True)"`
