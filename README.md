<h1 align="center">Seanime Providers</h1>

<p align="center">
  <img src="https://img.shields.io/github/last-commit/Pal-droid/Seanime-Providers?logo=git&logoColor=white&labelColor=2d3748&color=805ad5&style=for-the-badge" />
  <img src="https://img.shields.io/github/license/Pal-droid/Seanime-Providers?style=for-the-badge" />
  <img src="https://img.shields.io/website?url=https://pal-droid.github.io/Seanime-Providers/&label=Marketplace&logoColor=white&color=2ea44f&style=for-the-badge" />
</p>

<p align="center">
This repository contains custom <strong><a href="https://github.com/5rahim/seanime">Seanime</a></strong> plugins and extensions for adding support to various manga and anime sources.
</p>

<h3 align="center">Powered by:</h3>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" />
</p>

## Repository Structure

```
src/
├── anime/
│   └── animeheaven/
|       ├── ...
|        ...
└── manga/
    ├── mangafreak/
    │   ├── provider.js
    │   ├── README.md
    │   ├── manga-provider.d.ts
    │   └── manifest.json
    └── scanita/
        ├── provider.js
        ├── ....
         ...
```

Each folder represents a standalone Seanime extension provider.

---

## Installation

1. Open Seanime.  
2. Go to the **Extensions** tab.

<img src="https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/refs/heads/main/public/first_step.jpg"></img>

3. Select **Add extensions**.

<img src="https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/refs/heads/main/public/second_step.jpg"></img>


4. Paste the **raw GitHub URL** of the desired `manifest.json` file, for example:

```
https://raw.githubusercontent.com/pal-droid/seanime-providers/main/src/manga/comix/manifest.json
```

<img src="https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/refs/heads/main/public/last_step.jpg"></img>


5. Seanime will automatically fetch and register the provider.

---

## Where can I find the manifest URLs?

[Click here](https://github.com/Pal-droid/Seanime-Providers/tree/main/marketplace/README.md) to see full list of extensions

or

[Click here](https://pal-droid.github.io/Seanime-Providers/) to visit the extensions Marketplace

---

### Want to suggest more providers?
> PR's welcomed!

[Open an issue](https://github.com/Pal-droid/Seanime-Providers/issues/new?template=provider_request.yml)

Or 

**[Hit me up on discord!](https://discord.com/users/1254072406667169855)**

---

### Credits ❤️

* [Seanime](https://github.com/5rahim/seanime) made by [5rahim](https://github.com/5rahim)

* [kRYstall9](https://github.com/kRYstall9) *(For the source code of [MangaWorldAdult](https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/src/manga/MangaWorldAdult/manifest.json), [HentaiWorld](https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/src/anime/hentaiworld/manifest.json), and [HentaiSaturn](https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/src/anime/hentaisaturn/manifest.json))*

* [SyntaxSama](https://github.com/syntaxsama) *(For the source code of the visual marketplace; Original owner of the Anime News, Always Advanced Search, Cookie clicker, Anti-Seeding plugins and Animepahe extension)*

* [Dantotsu](https://discord.gg/MSJvfJzS7R) *(The Anilist activity plugin is inspired by Dantotsu's stories feature.)*

---

### Extra info

- [License](./LICENSE)
- [TO;DO List](./TO;DO.md)

### Other related projects (Made by me)

- [Seanime Android](https://github.com/Pal-droid/seanime-android)

### Other connections

<p align="center">
  <a href="https://discord.gg/syeSKs4R9H">
    <img src="https://img.shields.io/discord/1224767201551192224?color=5865F2&label=Discord&logo=discord&logoColor=white" />
  </a>
</p>

<p align="center">
  &#8226; <a href="https://discord.gg/syeSKs4R9H">Seanime Discord server</a>
</p>
