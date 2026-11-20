#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <secpol/secpol.h>
#include <sys/dispatch.h>
#include <sys/iofunc.h>
#include <sys/neutrino.h>
#include <sys/resmgr.h>

#include "adas_proto.h"

/* criticality: high — fusion server calls back into the sensor manager. */

static resmgr_connect_funcs_t connect_funcs;
static resmgr_io_funcs_t io_funcs;
static iofunc_attr_t attr;

static int io_devctl(resmgr_context_t *ctp, io_devctl_t *msg, RESMGR_OCB_T *ocb) {
    adas_frame_t frame;
    int fd;
    int coid;

    (void)msg;
    (void)ocb;
    memset(&frame, 0, sizeof frame);
    fd = open("/dev/adas/sensor", O_RDWR);
    MsgSend(fd, &frame, sizeof frame, &frame, sizeof frame);
    coid = ConnectAttach(ND_LOCAL_NODE, 0, 0, _NTO_SIDE_CHANNEL, 0);
    (void)coid;
    MsgReply(ctp->rcvid, EOK, &frame, sizeof frame);
    return _RESMGR_NOREPLY;
}

int main(void) {
    dispatch_t *dpp;
    dispatch_context_t *ctp;
    resmgr_attr_t resmgr_attr;
    int id;

    dpp = dispatch_create();
    if (dpp == NULL) {
        return EXIT_FAILURE;
    }
    iofunc_func_init(_RESMGR_CONNECT_NFUNCS, &connect_funcs, _RESMGR_IO_NFUNCS, &io_funcs);
    io_funcs.devctl = io_devctl;
    iofunc_attr_init(&attr, S_IFCHR | 0666, 0, 0);
    memset(&resmgr_attr, 0, sizeof resmgr_attr);
    id = resmgr_attach(dpp, &resmgr_attr, "/dev/adas/fusion", _FTYPE_ANY, 0,
                       &connect_funcs, &io_funcs, &attr);
    if (id == -1) {
        return EXIT_FAILURE;
    }
    secpol_transition_type(NULL, "fusion_t", 0);

    ctp = dispatch_context_alloc(dpp);
    while (1) {
        ctp = dispatch_block(ctp);
        if (ctp == NULL) {
            return EXIT_FAILURE;
        }
        dispatch_handler(ctp);
    }
}
