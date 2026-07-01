param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$requiredColumns = @(
    'ID',
    'Type',
    'SKU',
    'Name',
    'Published',
    'Visibility in catalog',
    'In stock?',
    'Stock',
    'Regular price',
    'Categories',
    'Images'
)

$brandCodeOverrides = @{
    'Phoenix Industries' = 'PHX'
}

function Get-CleanText {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }
    return (($Value -replace '\s+', ' ').Trim())
}

function Convert-ToTitleCase {
    param([AllowNull()][string]$Value)
    $clean = Get-CleanText $Value
    if ($clean -eq '') {
        return ''
    }

    $textInfo = [Globalization.CultureInfo]::InvariantCulture.TextInfo
    $lower = $clean.ToLowerInvariant()
    return $textInfo.ToTitleCase($lower)
}

function Get-CodeFromText {
    param(
        [AllowNull()][string]$Value,
        [string]$Fallback
    )

    $clean = Get-CleanText $Value
    $letters = ($clean -replace '[^A-Za-z0-9 ]', '').Trim()
    if ($letters -eq '') {
        return $Fallback
    }

    if ($brandCodeOverrides.ContainsKey($clean)) {
        return $brandCodeOverrides[$clean]
    }

    $words = @($letters -split '\s+' | Where-Object { $_ })
    if ($words.Count -gt 1) {
        $initials = -join ($words | ForEach-Object { $_.Substring(0, 1).ToUpperInvariant() })
        if ($initials.Length -ge 3) {
            return $initials.Substring(0, 3)
        }
        $combined = ($initials + (($words -join '') -replace '[AEIOUaeiou]', '').ToUpperInvariant())
        return ($combined + 'XXX').Substring(0, 3)
    }

    $word = $words[0].ToUpperInvariant()
    $consonants = $word.Substring(0, 1) + (($word.Substring([Math]::Min(1, $word.Length))) -replace '[AEIOU]', '')
    return ($consonants + $word + 'XXX').Substring(0, 3)
}

function Convert-Categories {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    $paths = foreach ($path in ($Value -split ',')) {
        $levels = foreach ($level in ($path -split '>')) {
            $title = Convert-ToTitleCase $level
            if ($title) {
                $title
            }
        }
        if ($levels.Count -gt 0) {
            ($levels -join ' > ')
        }
    }

    return (@($paths | Where-Object { $_ } | Select-Object -Unique) -join ', ')
}

function Get-LeafCategory {
    param([AllowNull()][string]$Categories)
    if ([string]::IsNullOrWhiteSpace($Categories)) {
        return 'General'
    }

    $firstPath = @($Categories -split ',' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })[0]
    if ([string]::IsNullOrWhiteSpace($firstPath)) {
        return 'General'
    }

    $levels = @($firstPath -split '>' | ForEach-Object { Get-CleanText $_ } | Where-Object { $_ })
    if ($levels.Count -eq 0) {
        return 'General'
    }

    return $levels[$levels.Count - 1]
}

function Get-ParentId {
    param([AllowNull()][string]$Parent)
    if ([string]::IsNullOrWhiteSpace($Parent)) {
        return ''
    }
    if ($Parent -match '^id:(\d+)$') {
        return $Matches[1]
    }
    return ''
}

function Get-ParentKey {
    param([AllowNull()][string]$Parent)
    if ([string]::IsNullOrWhiteSpace($Parent)) {
        return ''
    }
    if ($Parent -match '^id:(\d+)$') {
        return $Matches[1]
    }
    return $Parent.Trim()
}

function Get-NumericStock {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return 0
    }

    $number = 0.0
    if ([double]::TryParse($Value, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return [Math]::Max(0, [int][Math]::Floor($number))
    }

    return 0
}

$rows = @(Import-Csv -LiteralPath $InputPath)
if ($rows.Count -eq 0) {
    throw "No rows found in $InputPath"
}

$originalColumns = @($rows[0].PSObject.Properties.Name)
foreach ($column in $requiredColumns) {
    if ($originalColumns -notcontains $column) {
        foreach ($row in $rows) {
            $row | Add-Member -NotePropertyName $column -NotePropertyValue ''
        }
        $originalColumns += $column
    }
}

$parentById = @{}
$parentBySku = @{}
foreach ($row in $rows) {
    if (-not [string]::IsNullOrWhiteSpace($row.ID)) {
        $parentById[$row.ID] = $row
    }
    if (-not [string]::IsNullOrWhiteSpace($row.SKU)) {
        $parentBySku[$row.SKU.Trim()] = $row
    }
}

$usedSkus = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($row in $rows) {
    if (-not [string]::IsNullOrWhiteSpace($row.SKU)) {
        [void]$usedSkus.Add($row.SKU.Trim())
    }
}

$sequenceByPrefix = @{}
$generatedSkuCount = 0

foreach ($row in $rows) {
    $row.Categories = Convert-Categories $row.Categories

    $stock = Get-NumericStock $row.Stock
    $row.Stock = [string]$stock
    $row.'In stock?' = if ($stock -gt 0) { '1' } else { '0' }

    if ([string]::IsNullOrWhiteSpace($row.SKU)) {
        $source = $row
        $parentKey = Get-ParentKey $row.Parent
        if ($parentKey -and $parentById.ContainsKey($parentKey)) {
            $source = $parentById[$parentKey]
        }
        elseif ($parentKey -and $parentBySku.ContainsKey($parentKey)) {
            $source = $parentBySku[$parentKey]
        }

        $brand = Get-CleanText $source.Brands
        if ($brand -eq '') {
            $brand = 'Generic'
        }

        $categoriesForSku = if ($source.Categories) { $source.Categories } else { $row.Categories }
        $category = Get-LeafCategory $categoriesForSku

        $brandCode = Get-CodeFromText -Value $brand -Fallback 'GEN'
        $categoryCode = Get-CodeFromText -Value $category -Fallback 'GEN'
        $prefix = "$brandCode-$categoryCode"

        if (-not $sequenceByPrefix.ContainsKey($prefix)) {
            $sequenceByPrefix[$prefix] = 1
        }

        do {
            $candidate = '{0}-{1:000}' -f $prefix, $sequenceByPrefix[$prefix]
            $sequenceByPrefix[$prefix]++
        } while ($usedSkus.Contains($candidate))

        $row.SKU = $candidate
        [void]$usedSkus.Add($candidate)
        $generatedSkuCount++
    }
    else {
        $row.SKU = $row.SKU.Trim()
    }
}

$columnsToRemove = @(
    'Variation Swatches',
    'Attributes Swatches'
)

$outputColumns = @(
    $originalColumns |
        Where-Object {
            ($_ -notlike 'Meta:*') -and
            ($columnsToRemove -notcontains $_)
        }
)

$rows |
    Select-Object $outputColumns |
    Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8

$cleanedRows = @(Import-Csv -LiteralPath $OutputPath)
$missingSku = @($cleanedRows | Where-Object { [string]::IsNullOrWhiteSpace($_.SKU) }).Count
$missingStock = @($cleanedRows | Where-Object { [string]::IsNullOrWhiteSpace($_.Stock) }).Count
$missingRequiredColumns = @($requiredColumns | Where-Object { $outputColumns -notcontains $_ })
$metaColumns = @($outputColumns | Where-Object { $_ -like 'Meta:*' }).Count

[pscustomobject]@{
    InputRows              = $rows.Count
    OutputRows             = $cleanedRows.Count
    GeneratedSkus          = $generatedSkuCount
    MissingSkusAfter       = $missingSku
    MissingStockAfter      = $missingStock
    MissingRequiredColumns = ($missingRequiredColumns -join ', ')
    RemainingMetaColumns   = $metaColumns
    OutputPath             = (Resolve-Path -LiteralPath $OutputPath).Path
}
