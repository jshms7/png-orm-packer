# Use an ORM PNG in Godot 4.7

A packed map is **material data, not a colour texture**. For Godot's built-in `ORMMaterial3D`, the channels are:

| Channel | Meaning |
| --- | --- |
| Red | Ambient occlusion |
| Green | Roughness |
| Blue | Metallic |

Put the combined PNG in **ORM → Texture**, not Albedo. Use `ORMMaterial3D`, not a `StandardMaterial3D` with the same image assigned to three unrelated slots.

## Three steps, starting with the included examples

1. **Make the map.** [Download PNG ORM Packer v0.2](https://github.com/jshms7/png-orm-packer/releases/tag/v0.2.0), extract it, and open `texture-batch.html` in desktop Chrome or Firefox. Select the six PNGs in `examples/` together, leave roughness inversion off, and click **Pack ready sets**, then **Download packed ZIP**. Extract that ZIP. It contains `stone_orm.png`, `wood_orm.png` and a text report. These tiny synthetic maps are for checking the workflow, not finished surface artwork.
2. **Create the material.** Copy `stone_orm.png` into the root of a Godot project, beside `project.godot`. Save the text below as `stone.tres` in that same folder. Return to the editor and let the texture import finish. Double-click `stone.tres` in the FileSystem dock to inspect it.
3. **Assign it.** Select your `MeshInstance3D` and drag `stone.tres` into its **Geometry → Material Override** property. This replaces the material on that mesh instance; use a spare mesh or a copy of your scene first. Light the scene to inspect roughness and metallic response. The packed image is not a colour preview of the final surface.

```ini
[gd_resource type="ORMMaterial3D" load_steps=2 format=3]

[ext_resource type="Texture2D" path="res://stone_orm.png" id="1_orm"]

[resource]
orm_texture = ExtResource("1_orm")
ao_enabled = true
```

The same material can be created in the Inspector: choose a new `ORMMaterial3D`, assign the PNG to **ORM → Texture**, and turn **Ambient Occlusion** **On**. The text resource above makes those settings explicit. It refers to a PNG in the project root; change the `res://` path if you put yours elsewhere.

## Before using your own maps

- **Use matching inputs.** The packer reads the red-channel byte of each source mask. Name a set, for example, `rock_ao.png`, `rock_roughness.png` and `rock_metallic.png`. All three need matching dimensions and a [supported PNG format](../README.md#format-and-batch-limits).
- **Roughness is not smoothness.** White roughness means rough; black means smooth. Use the packer's inversion only when your source is a smoothness/gloss map with the opposite meaning. Do not invert an ordinary roughness map merely because the packed PNG looks unusual.
- **Keep colour separate.** Add your base-colour texture in Albedo if needed. Do not apply an sRGB-to-linear conversion to the ORM bytes yourself. Godot's built-in ORM texture slot consumes these channels as data; a custom shader needs its own correct sampler setup.
- **AO must be enabled.** The resource above enables it. Whether occlusion is visible also depends on the scene's lighting and the material's AO settings. A flat or dark-looking scene is not a reliable channel-byte test.
- **Godot may change import settings when you first use a texture in 3D.** In the tested editor, assigning the material triggered automatic VRAM compression and mipmap generation. That can change the imported data without changing your PNG. For a byte-preservation check after assignment, select the PNG in FileSystem, open **Import**, set **Compress → Mode** to **Lossless**, turn **Mipmaps → Generate** off, and **Reimport**. Leave normal-map and roughness processing off for that check. Mipmaps can be useful in a real scene; this diagnostic setting is not a recommendation to disable them for every material. Exact bytes are not promised after lossy/VRAM compression or other processing.

## Checked scope

The example resource and the packer's downloaded synthetic output were loaded with the actual Godot **4.7.2** importer and assigned to a mesh in its editor. With Lossless compression and no mipmaps after reimport, the imported 2 × 2 texture retained its bytes; its top-left RGBA pixel is `(0, 17, 255, 255)`. This is a numeric check, not a target appearance for your material. The packer does not configure Godot or edit your scene. Other engine versions, custom shaders, exported games and lossy import paths are outside this guide's check.

Godot reference: [Standard Material 3D and ORM Material 3D](https://docs.godotengine.org/en/4.7/tutorials/3d/standard_material_3d.html), [ORMMaterial3D](https://docs.godotengine.org/en/4.7/classes/class_ormmaterial3d.html), and [importing images](https://docs.godotengine.org/en/4.7/tutorials/assets_pipeline/importing_images.html).
