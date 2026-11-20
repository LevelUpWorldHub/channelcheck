#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <secpol/secpol.h>
#include <sys/dispatch.h>
#include <sys/iofunc.h>
#include <sys/neutrino.h>
#include <sys/siginfo.h>

#define PUMP_PULSE 0x41

static resmgr_connect_funcs_t connect_funcs;
static resmgr_io_funcs_t io_funcs;
static iofunc_attr_t attr;

typedef struct {
    uint32_t rate_ml_h;
    uint32_t vtbi_ml;
} pump_cmd_t;

static int io_devctl(resmgr_context_t *ctp, io_devctl_t *msg, RESMGR_OCB_T *ocb) {
    pump_cmd_t cmd;
    (void)msg;
    (void)ocb;
    memset(&cmd, 0, sizeof cmd);
    /* Therapy setpoint is applied with no credential or secpol check. */
    MsgReply(ctp->rcvid, EOK, &cmd, sizeof cmd);
    return _RESMGR_NOREPLY;
}

static void arm_tick(int coid) {
    struct sigevent event;
    SIGEV_PULSE_INIT(&event, coid, SIGEV_PULSE_PRIO_INHERIT, PUMP_PULSE, 0);
    (void)event;
}

int main(void) {
    dispatch_t *dpp;
    dispatch_context_t *ctp;
    resmgr_attr_t resmgr_attr;
    struct _pulse pulse;
    int id;
    int chid;
    int self;

    chid = ChannelCreate_r(0);
    if (chid < 0) {
        return EXIT_FAILURE;
    }
    dpp = dispatch_create_channel(chid, 0);
    if (dpp == NULL) {
        return EXIT_FAILURE;
    }
    self = ConnectAttach(0, 0, chid, _NTO_SIDE_CHANNEL, _NTO_COF_CLOEXEC);
    if (self == -1) {
        return EXIT_FAILURE;
    }
    arm_tick(self);

    iofunc_func_init(_RESMGR_CONNECT_NFUNCS, &connect_funcs, _RESMGR_IO_NFUNCS, &io_funcs);
    io_funcs.devctl = io_devctl;
    iofunc_attr_init(&attr, S_IFCHR | 0600, 0, 0);
    memset(&resmgr_attr, 0, sizeof resmgr_attr);
    id = resmgr_attach(dpp, &resmgr_attr, "/dev/infusion/pump", _FTYPE_ANY, 0,
                       &connect_funcs, &io_funcs, &attr);
    if (id == -1) {
        return EXIT_FAILURE;
    }
    secpol_transition_type(NULL, "pump_t", 0);

    for (;;) {
        if (MsgReceivePulse(chid, &pulse, sizeof pulse, NULL) == -1) {
            return EXIT_FAILURE;
        }
        ctp = dispatch_context_alloc(dpp);
        if (ctp == NULL) {
            return EXIT_FAILURE;
        }
        dispatch_handler(ctp);
        dispatch_context_free(ctp);
    }
}
