Add-Type -AssemblyName System.Drawing

$sourcePath = Resolve-Path "assets/icon.png"
$targetPath = "assets/icon.ico"
$source = [System.Drawing.Image]::FromFile($sourcePath)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = New-Object "System.Collections.Generic.List[byte[]]"

foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $graphics.Dispose()

  $xorSize = $size * $size * 4
  $andStride = [Math]::Floor(($size + 31) / 32) * 4
  $andSize = $andStride * $size
  $stream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter $stream

  $writer.Write([UInt32]40)
  $writer.Write([Int32]$size)
  $writer.Write([Int32]($size * 2))
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]0)
  $writer.Write([UInt32]($xorSize + $andSize))
  $writer.Write([Int32]0)
  $writer.Write([Int32]0)
  $writer.Write([UInt32]0)
  $writer.Write([UInt32]0)

  for ($y = $size - 1; $y -ge 0; $y--) {
    for ($x = 0; $x -lt $size; $x++) {
      $color = $bmp.GetPixel($x, $y)
      $writer.Write([byte]$color.B)
      $writer.Write([byte]$color.G)
      $writer.Write([byte]$color.R)
      $writer.Write([byte]$color.A)
    }
  }

  $writer.Write((New-Object byte[] $andSize))
  $writer.Flush()
  $images.Add($stream.ToArray())
  $writer.Dispose()
  $stream.Dispose()
  $bmp.Dispose()
}

$out = New-Object System.IO.FileStream $targetPath, ([System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter $out
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$images.Count)

$offset = 6 + (16 * $images.Count)
for ($i = 0; $i -lt $images.Count; $i++) {
  $size = $sizes[$i]
  $data = $images[$i]
  $encodedSize = if ($size -eq 256) { [byte]0 } else { [byte]$size }

  $writer.Write($encodedSize)
  $writer.Write($encodedSize)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$data.Length)
  $writer.Write([UInt32]$offset)
  $offset += $data.Length
}

foreach ($data in $images) {
  $writer.Write($data)
}

$writer.Dispose()
$out.Dispose()
$source.Dispose()

Get-Item $targetPath | Select-Object Name, Length, LastWriteTime
