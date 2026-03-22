---
sidebar_position: 1
sidebar_label: GPS Configuration
title: GPS Configuration
description: GPS navigation model: Pedestrian, Automotive, Air<1g, Air<2g, Air<4g. Default is AIR_2G. Use pedestrian/Automotive with caution, can cause flyaways with fast flying.
---

# GPS Configuration

GPS navigation model: Pedestrian, Automotive, Air\<1g, Air\<2g, Air\<4g. Default is AIR_2G. Use pedestrian/Automotive with caution, can cause flyaways with fast flying.

:::note
For most fixed-wing aircraft, Air\<2g is recommended.
:::

## CLI Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| gps_model | \{0-4\} | 3 | Navigation model selection |
| gps_min_sats | \{5-20\} | 6 | Minimum satellites for fix |

## Example Configuration

```bash
# Set GPS model to Air<2g
set gps_model = 3
set gps_min_sats = 8
save
```

The minimum satellites value should be \>5 for reliable navigation.

<br />
<img src="gps-wiring.png" alt="GPS Wiring Diagram" className="diagram" />

:::warning
GPS units with protocol version \<15.0 are deprecated.
:::

## Troubleshooting

If GPS fix takes longer than expected:

1. Check antenna placement
2. Ensure clear sky view
3. Verify baud rate is \{9600-115200\}

Replace \<YOUR_GPS_PORT\> with the actual UART number.

For Array\<number\> type parameters, use comma-separated values.
