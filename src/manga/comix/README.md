# Comix

Manga provider for [comix.to](https://comix.to).

comix.to sits behind a Cloudflare challenge, signs every API call, and encrypts most responses. The extension handles the signing and decryption itself. It can't get past Cloudflare on its own, so it borrows the clearance cookie your browser already earned.

## Setup

1. Add the extension in Seanime under `Settings > Extensions` with this manifest URL:

   ```
   https://raw.githubusercontent.com/Ari-03/Seanime-Providers/main/src/manga/comix/manifest.json
   ```

2. Open https://comix.to in a normal browser and wait until the site loads. If Cloudflare shows a check, pass it.
3. Copy the `cf_clearance` cookie. In Chrome, Edge or Brave, open DevTools, go to `Application > Cookies > https://comix.to` and copy the value of `cf_clearance`. In Firefox it is under `Storage > Cookies`.
4. Copy the User-Agent of the same browser. Run `navigator.userAgent` in the DevTools console and copy the result without the quotes.
5. Paste both into the extension settings in Seanime.

The cookie and the User-Agent must come from the same browser. Cloudflare ties the cookie to the User-Agent it was issued for and rejects it with any other one. Pasting `cf_clearance=...` with the name in front also works.

Search result covers on `static.comix.to` sit behind the same Cloudflare check, so the extension hands your cookie and User-Agent to Seanime's image proxy for those covers. That puts the cookie in the image-proxy URL your Seanime client requests from your own Seanime server. Covers from other hosts and chapter pages get no cookie.

## Chrome on the Seanime host

Optional, but it saves you from waiting on extension updates.

The signing keys live in the site's obfuscated JavaScript and change when comix.to ships a new build. The extension bundles the keys for the current build, `tmboun`, so it works without Chrome until the site rotates them.

After a rotation the site starts rejecting the old keys. If Google Chrome or Chromium is installed on the machine running Seanime, the extension opens comix.to in headless Chrome with your cookie, reads the new keys while the page decodes them, and carries on. That takes about two seconds. Requests that arrive meanwhile wait for that one capture instead of starting their own Chrome, including the parallel page requests of a chapter list that is still loading. While capturing, Chrome skips images and third-party fonts and analytics. Without Chrome you get an error asking you to install it or wait for an extension update.

Seanime finds Chrome at `/Applications/Google Chrome.app` or `/Applications/Chromium.app` on macOS, in the default install folders on Windows, and as `chromium` or `google-chrome` on the `PATH` on Linux.

## Errors

The extension reports problems in Seanime's error message and logs. It doesn't return an empty list.

- **Cloudflare rejected the request.** The cookie expired or doesn't match the User-Agent. Repeat steps 2 to 5.
- **comix.to's firewall wants a captcha.** Open comix.to in your browser, solve the check, wait a minute and retry.
- **Chrome could not start.** The keys rotated and Chrome isn't installed. Install it or wait for an update.
- **Chrome stopped while capturing.** Chrome crashed or was killed mid-capture. Retry, and check that Chrome runs on the Seanime host.
- **Could not reach comix.to.** A network failure between Seanime and comix.to that persisted through the automatic retry. Each request to comix.to gets one retry, after a pause of up to 3 seconds, for a network error, HTTP 5xx or HTTP 429. Cloudflare, captcha and token errors are reported straight away instead. Retry once the connection is back.
- **Returned an error or no list.** comix.to answered, but not with the expected data. Nothing is cached, so retrying is safe; if it persists, the API changed.
- **Still rejects requests after refreshing.** The site changed how it signs requests. The extension needs an update.

## Known limitations

- `cf_clearance` normally lasts about a year, but Cloudflare can revoke it sooner, and a browser update changes your User-Agent. Either one means pasting fresh values. Whether the cookie stops working when your IP changes hasn't been tested.
- Only English chapters are listed.
- comix.to can mark pages as scrambled. On 2026-10-04 none of 3,795 pages across 60 chapters of 30 popular series were, so the extension has no descrambler. If scrambled pages show up, they will look like shuffled tiles.
- Page images must load without a `Referer` header. The extension routes them through Seanime's image proxy for that reason.
