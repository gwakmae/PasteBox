$htmlFile = "index.html"
$cssFiles = @(
    "css/base.css",
    "css/layout.css",
    "css/cards.css"
)
$jsFiles = @(
    "js/enums.js",
    "js/dataService.js",
    "js/cardListView.js",
    "js/modalView.js",
    "js/app.js"
)
$outFile = "PasteBox.html"

$html = Get-Content $htmlFile -Raw -Encoding UTF8

# Combine CSS
$allCss = ""
foreach ($f in $cssFiles) {
    $allCss += "/* === $f === */`n"
    $allCss += (Get-Content $f -Raw -Encoding UTF8) + "`n"
}

# Replace CSS links with style block
$cssPattern = '(?s)<link\s+rel="stylesheet"[^>]*>\s*(<link\s+rel="stylesheet"[^>]*>\s*)*'
$cssMatch = [regex]::Match($html, $cssPattern)
if ($cssMatch.Success) {
    $html = $html.Substring(0, $cssMatch.Index) + "<style>`n$allCss</style>`n" + $html.Substring($cssMatch.Index + $cssMatch.Length)
}

# Combine JS
$allJs = ""
foreach ($f in $jsFiles) {
    $allJs += "// === $f ===`n"
    $allJs += (Get-Content $f -Raw -Encoding UTF8) + "`n"
}

# Replace script tags with combined script block
$jsPattern = '(?s)<script\s+src="[^"]*"></script>\s*(<script\s+src="[^"]*"></script>\s*)*'
$jsMatch = [regex]::Match($html, $jsPattern)
if ($jsMatch.Success) {
    $html = $html.Substring(0, $jsMatch.Index) + "<script>`n$allJs</script>`n" + $html.Substring($jsMatch.Index + $jsMatch.Length)
}

Set-Content -Path $outFile -Value $html -Encoding UTF8
$size = (Get-Item $outFile).Length
Write-Host ""
Write-Host "=== PasteBox Build ===" -ForegroundColor Cyan
Write-Host "CSS files: $($cssFiles.Count)" -ForegroundColor Gray
Write-Host "JS files:  $($jsFiles.Count)" -ForegroundColor Gray
Write-Host "Output: $outFile ($([math]::Round($size/1024,1)) KB)" -ForegroundColor Green
