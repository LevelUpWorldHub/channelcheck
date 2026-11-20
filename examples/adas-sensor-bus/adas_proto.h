#ifndef ADAS_PROTO_H
#define ADAS_PROTO_H

#include <stdint.h>

#define ADAS_SENSOR_PATH "/dev/adas/sensor"
#define ADAS_FUSION_PATH "/dev/adas/fusion"
#define ADAS_PULSE_CODE 0x21

typedef struct {
    uint16_t type;
    uint16_t range_mm;
    uint16_t velocity_cm_s;
    uint16_t confidence;
} adas_frame_t;

#endif
