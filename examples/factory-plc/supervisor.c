#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <sys/neutrino.h>

typedef struct {
    uint32_t coil;
    uint32_t state;
} plc_cmd_t;

int main(void) {
    plc_cmd_t cmd;
    iov_t siov[1];
    iov_t riov[1];
    int fd;
    int coid;

    memset(&cmd, 0, sizeof cmd);
    cmd.coil = 4;
    cmd.state = 1;
    fd = name_open("/dev/plc/cell", 0);
    if (fd == -1) {
        return EXIT_FAILURE;
    }
    SETIOV(&siov[0], &cmd, sizeof cmd);
    SETIOV(&riov[0], &cmd, sizeof cmd);
    if (MsgSendv(fd, siov, 1, riov, 1) == -1) {
        return EXIT_FAILURE;
    }
    /* @channelcheck-target: /dev/plc/cell */
    coid = ConnectAttach(ND_LOCAL_NODE, 0, 0, _NTO_SIDE_CHANNEL, 0);
    if (coid == -1) {
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
