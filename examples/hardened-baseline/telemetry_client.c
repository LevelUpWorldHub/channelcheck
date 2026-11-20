#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <sys/neutrino.h>

typedef struct {
    uint32_t sample;
} tel_msg_t;

int main(void) {
    tel_msg_t msg;
    int fd;
    memset(&msg, 0, sizeof msg);
    fd = open("/dev/telemetry", O_RDONLY);
    if (fd == -1) {
        return EXIT_FAILURE;
    }
    if (MsgSend(fd, &msg, sizeof msg, &msg, sizeof msg) == -1) {
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
