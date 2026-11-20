#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <secpol/secpol.h>
#include <sys/dispatch.h>
#include <sys/iofunc.h>
#include <sys/neutrino.h>
#include <sys/resmgr.h>

static resmgr_connect_funcs_t connect_funcs;
static resmgr_io_funcs_t io_funcs;
static iofunc_attr_t attr;

static int io_devctl(resmgr_context_t *ctp, io_devctl_t *msg, RESMGR_OCB_T *ocb) {
    int status;
    if ((status = iofunc_devctl_default(ctp, msg, ocb)) != _RESMGR_DEFAULT) {
        return status;
    }
    if (ctp->info.cred.euid != 0) {
        return EPERM;
    }
    return EOK;
}

static void raw_channel(int chid) {
    struct _pulse pulse;
    int rcvid;
    while ((rcvid = MsgReceive(chid, &pulse, sizeof pulse, NULL)) > 0) {
        MsgReply(rcvid, EOK, NULL, 0);
    }
}

int main(void) {
    dispatch_t *dpp;
    dispatch_context_t *ctp;
    resmgr_attr_t resmgr_attr;
    int id;
    int chid;

    chid = ChannelCreate(_NTO_CHF_FIXED_PRIORITY);
    if (chid == -1) {
        return EXIT_FAILURE;
    }
    dpp = dispatch_create_channel(chid, 0);
    if (dpp == NULL) {
        return EXIT_FAILURE;
    }
    iofunc_func_init(_RESMGR_CONNECT_NFUNCS, &connect_funcs, _RESMGR_IO_NFUNCS, &io_funcs);
    io_funcs.devctl = io_devctl;
    iofunc_attr_init(&attr, S_IFCHR | 0660, 0, 0);
    memset(&resmgr_attr, 0, sizeof resmgr_attr);
    id = resmgr_attach(dpp, &resmgr_attr, "/dev/plc/cell", _FTYPE_ANY, 0,
                       &connect_funcs, &io_funcs, &attr);
    if (id == -1) {
        return EXIT_FAILURE;
    }
    secpol_transition_type(NULL, "plc_t", 0);
    (void)raw_channel;

    ctp = dispatch_context_alloc(dpp);
    while (1) {
        ctp = dispatch_block(ctp);
        if (ctp == NULL) {
            return EXIT_FAILURE;
        }
        dispatch_handler(ctp);
    }
}
