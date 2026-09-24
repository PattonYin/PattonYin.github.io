# Jiyang (Patton) Yin — personal website

A static research portfolio built with HTML, CSS, and JavaScript.

## Preview

Run `python serve.py` and open <http://127.0.0.1:8000>. No build step or package
installation is required. Use an HTTP server rather than opening `index.html`
directly, because publications load from JSON.

## Edit

- `index.html`: biography, navigation, and profile links.
- `css/style.css`: responsive layout and light/dark themes.
- `data/content.json`: publications; retained gallery entries are not displayed.
- `assets/publications/`: publication teaser images.
- `js/robots.js`, `data/trajectories.json`: interactive robot viewers and motion tracks.
- `assets/robots/`: compact robot meshes, kinematics, and model licenses.
- `assets/gallery/`: retained compressed media, currently not displayed on the site.

Keep raw recordings outside the repository. The old `Gallary/` source folder,
MOV files, and WebM captures are ignored; use small MP4 exports for the site.
Aim for less than 5 MB per clip. The site currently has no gallery section.

Deploy the repository root on any static host, including GitHub Pages.

## Publication images

To add a teaser, save the image in `assets/publications/` and add these fields
to its publication entry in `data/content.json`:

```json
"image": "assets/publications/your-paper.jpg",
"imageAlt": "A short description of the figure."
```

Leave `image` out for a text-only entry. Images appear beside the publication
on desktop and above it on mobile; figures are shown without cropping.
