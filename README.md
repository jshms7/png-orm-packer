# PNG ORM channel packer

Free experimental, AI-developed software for combining ambient occlusion (AO), roughness and metallic texture masks into ORM PNGs. A downloadable local tool, not an online conversion service or a paid product.

## Use

Extract the download ZIP and open `texture-batch.html` in a recent desktop browser with native CompressionStream and DecompressionStream support. No installation, tool account or product API key is needed.

1. Choose individual PNG files from one folder. Start with the six original synthetic files in `examples/`.
2. Match names such as `stone_ao.png`, `stone_roughness.png`, `stone_metallic.png`. Directory and material spelling must match exactly; channel suffixes are case-insensitive.
3. Review the ready sets, then select **Pack ready sets** and **Download packed ZIP**. Nonmatching filenames are ignored, not listed as exceptions.
4. Each set becomes one `_orm.png`. The included text report explains selection exceptions and failed matched sets. Try the examples before relying on a result.

R = AO red-channel byte, G = roughness red-channel byte, B = metallic red-channel byte, A = 255. Input alpha does not change these values. Optional roughness inversion uses 255 minus the input value. There is no resizing or colour adjustment. Originals are read, never overwritten.

The folder picker is experimental and unverified. The tested route is individual-file selection in Linux desktop HeadlessChrome145. That is not a claim of broad browser, operating-system or game-engine compatibility. Numeric output checks use original synthetic fixtures, not customer validation.

## Limits

Only8-bit, non-interlaced grayscale/RGB/grayscale-alpha/RGBA PNGs. No palette,16-bit,animated PNGs or other formats. All three masks must have the same dimensions. Up to4096x4096 and32MiB per input file;500files and256MiB compressed input total. Encoded images also have a32MiB limit, so large noisy images can fail even below the dimension limit. Output payload120MiB; final ZIP128MiB. Failures are reported rather than silently converted. Continuous peak memory is not guaranteed; use small batches first.

## Source and reuse

The original modules are in `src/png.cjs` and `src/batch.cjs`; `src/page.html` is the wrapper. To reproduce the standalone page using Python3 standard library:

```python
from pathlib import Path
page = Path('src/page.html').read_text()
for marker, name in [('/* PNG_MODULE */', 'src/png.cjs'), ('/* BATCH_MODULE */', 'src/batch.cjs')]:
    page = page.replace(marker, Path(name).read_text())
Path('texture-batch.html').write_text(page)
```

Code and synthetic examples are offered under the included Unlicense, to the extent permissions can be granted. AI development is disclosed; no exclusive authorship or third-party rights clearance is claimed. This is an unsupported experimental snapshot, not a production reliability guarantee or a support service.

## Download and privacy notice

No email, payment, uploads, feedback, personal information or support requests are requested by this project. The extracted HTML processes your selected files in your browser. It has no upload endpoint, analytics, external script/font or activation check, and does not store selected files in a remote workspace.

GitHub hosts the repository and download. GitHub processes request/device data such as IP addresses under its [Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Downloading from GitHub is separate from subsequent local processing. We may inspect only aggregate release-asset download counts, not downloader identities; a count is not a unique-person, successful-use or demand measure. No additional tracking is included.
