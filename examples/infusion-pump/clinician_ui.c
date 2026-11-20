#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <sys/neutrino.h>

typedef struct {
    uint32_t rate_ml_h;
    uint32_t vtbi_ml;
} pump_cmd_t;

int main(void) {
    pump_cmd_t cmd;
    int fd;
    memset(&cmd, 0, sizeof cmd);
    cmd.rate_ml_h = 50;
    cmd.vtbi_ml = 100;
    fd = open("/dev/infusion/pump", O_RDWR);
    if (fd == -1) {
        return EXIT_FAILURE;
    }
    if (MsgSend(fd, &cmd, sizeof cmd, &cmd, sizeof cmd) == -1) {
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
